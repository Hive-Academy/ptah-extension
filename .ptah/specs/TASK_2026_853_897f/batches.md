# Batches - TASK_2026_853_897f

Total tasks: 41 | Batches: 41 | Complete: 0/41

Worktree: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet`
Branch: `feat/session-prefix-diet`
Task folder: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/.ptah/specs/TASK_2026_853_897f`

## Plan validation

Status: PASSED WITH RISKS

Gate 2 is APPROVED in `implementation-plan-review-round2.md:3-18`, decision #27. This decomposition does not revise the approved architecture or reopen decisions #20–27. Order is A → B → C → D, with one shipping PR per phase as specified in implementation-plan.md:3-5. Phase B reopens A's files only after A is accepted; C's builder JSDoc/index edits follow B. No production implementation has started. No checks were run during decomposition.

Evidence checked on disk: the worktree is on the requested branch; existing files named by the plan are extensions, not blank-slate replacements. Catalog, synced reader, scope field, migration service, settings card and notice are new. `docs/ptah-prompt-mapping.md` does not exist and must not be created merely to satisfy the conditional plan reference. Existing `InstalledSkill.scope` is the literal `global` at rpc-agents.types.ts:59-71; D contracts widen it before consumers. Existing intent store is v1 and positional; its producer/caller updates must be verified together. Existing external MCP installer actually registers servers (external-plugin-mcp.service.ts:145-205), confirming mandatory F-D4 consent correction. Verified capability flags are translated to `skillOverrides` at sdk-query-options-builder.ts:484-512; unverified isolation remains `skills: []`/strict MCP at :527-568. Manifest build currently applies the selection gate to overlays at harness-manifest.builder.ts:374-382; D must exempt only this workspace's skills.sh roots, not all overlays.

Assumptions (6; unresolved runtime assumptions are gates, not silent passes):

1. Main `disallowedTools` reaches generated AND built-in subagents — A0 transcript proof before any A/B code. If false, stop dependent implementation and return the evidence; do not silently ship generated-only coverage or change A AC2. The plan's generated-frontmatter fallback requires coordinator disposition of built-in types first.
2. Bare bundled and qualified `anthropic-skills:<name>` off overrides hide only their intended skills — A0 transcript proof. If qualified hiding fails, stop B; no bare-name fallback.
3. Unknown qualified override keys on a proxy without user settings do not prevent startup/streaming — A0.
4. Electron heavy boot happens after window creation — A0 read-only bootstrap trace; recheck when wiring Batch 35.
5. Bundled-origin clones are filtered by workspace enablement — A0 read-only plugin-origin gate trace; recheck in Batch 22. Existing builder invokes `createPluginOriginGate(sources)` at :349,361; invocation alone is not proof of the gate's semantics.
6. Harness gitignore maintenance covers workspace `.ptah/` roots — A0 read-only trace; validate workspace-root fixtures in Batches 25–26. If absent, report the exact gap before writing install roots.

| Risk | Severity | Mitigation / resolution required |
| --- | --- | --- |
| SDK inheritance or skill hiding differs at runtime | HIGH | Batch 1 A0; record each assumption separately with transcript paths and observed names; no implementation until accepted |
| Policy opt-ins widen an unverified capability policy | HIGH | Batches 5–7 and 10–12 preserve verified-only skill merge; isolation/settingSources/certified launch specs |
| A/B edits race in catalog, builder, handlers or card | HIGH | Phase barrier and serialized ownership below; B extends A in place |
| Missing token targets | MEDIUM | Phase evidence gate: A ≥2.5k main, B ≥3k main, C ≥1k main and no subagent regression, D no regression; raw samples and medians required |
| A unique instruction is lost during C | HIGH | Approved rule inventory R1–R36 is preserve list; independent pre-deletion inventory check, Batches 13–16; retain handshake and internal one-shot append |
| Retirement deletes user-authored, edited, tracked or linked data | HIGH | Batches 21–24 and 32–35; exact git exit proof, marker+all-file hashes, containment, lstat, disown-not-delete and real-git fixtures |
| Intent API/type changes break writers or hosts | HIGH | D contract owner first, explicit store-to-writer handoff; Batches 17–20 and 27–29; no failing intermediate commit or public push |
| Make global loses workspace install on failure | HIGH | Batches 25–26; stage/hash/metadata/rename/propagate/validate before source removal; retry and rollback fixtures |
| Retry loses or duplicates notice counts | HIGH | Batches 32–35; per-path durable ledger and two-workspace/mixed-fragment failures |
| External consent says servers are not registered | HIGH | Batch 1 BEFORE pair, Batch 39 mandatory copy/spec, Phase D AFTER pair; four Electron screenshots, no extra sign-off |
| Shared integration files collide | MEDIUM | Single owner per phase/file below; all integration handoffs serialized |
| Electron-only migration timing surprises other hosts / rollback loses v2 intents | MEDIUM | Phase D release/PR evidence states decisions #23/D-D5 and older-version empty-read behaviour; no new migration trigger in other hosts |

Edge cases: dependency blocked opt-ins (3–8); malformed/missing synced manifests, duplicate accounts and same-name workspace skills (9–12); no-folder/home targets and explicit global (18–20,27–31,36–39); v1 roots with matching clone are retired, not root-deleted (25,32–34); nonrepo/git unavailable/timeout are kept and disowned (23–24); newly encountered workspaces still consult retirement state (19,22–24); retired-only notice persists before chat and across restart (33–35,40).

## Decisions

- Batch by bounded file ownership, at most six production/test files and at most two owning projects per implementation batch. Evidence-only Batch 1 has no production writes. The approved plan supplies execution ordering; no new product/batching decision is requested.
- All batches are sequential internally and dispatched in listed order by default. This is intentionally conservative around integration and phase delivery. Coordinator may overlap only the explicitly disjoint windows: 5/6/7 after 2–4; 13–14 with 15–16 after the C inventory gate; 20 with 21; 27–29 with 25–26 after 17–24; 37–38 with 39 after 36. No two concurrent writers share files; verification uses the existing machine-wide lock, not extra worker parallelism.
- Single Phase D owners: Batch 17 owns every D edit to `rpc.types.ts`, `rpc-agents.types.ts`, `rpc-plugin-marketplace.types.ts` and any scope addition to `rpc-harness.types.ts`; Batch 21 owns shared retirement constants/health types; Batch 19 owns source-port/resolver retirement plumbing; Batch 22 owns manifest retired-clone filtering AND workspace selection exemption; Batch 26 owns plugin-loader retired-id skip AND workspace discovery; Batch 36 owns ALL marketplace-inventory.store edits (including fields consumed by skills and external-plugin UI); Batch 35 owns shared registration/DI. Downstream workers request changes from these owners, never co-edit.
- A/B overlap: A owns groups 1–2, catalog/dependencies and opt-in persistence. B adds only synced discovery/group 3 and account-qualified policy paths, retaining A's tests and terminal rows. Separate, sequential edits to the same file are intentional, never parallel ownership.
- No new provider, SDK, public tool name, least-privilege weakening, reverse conversion, settings permission change or skills-page redesign. Preserve scheduling, ListAgents, SendMessage, Monitor, TaskStop, NotebookEdit, old transcript renderers, workflows.disabled and all existing non-target skills. NO_BROWSER_NO_WEB production is unchanged (#20).
- No parity-inventory is required for the additive UI (#12/#17/#25). For C's replacement of instruction text and D's persistence refactor, use the approved rule inventory and delivery map as the explicit lane preserve lists; before completion compare them to the old surface at the recorded phase base and map every row to a passing check. Unlisted old capabilities block completion; approved removals only (#4/#5/#10/#20–27).

## Execution and verification contract (applies to every batch prompt)

Inputs are absolute paths under the task folder above: `task-description.md`, `implementation-plan.md` (the batch's cited lines), `context.md`, `decisions.md`, and for UI `design-spec.md`, `design-spec-review-round2.md`, `prototype/index.html`. `implementation-plan-review-round2.md` is the final approved plan gate, not a request for another plan review.

Repeat verbatim to every worker:

- Verify only with `npm run verify -- -p <projects>`.
- Electron first, keep every host compiling.
- Never commit/push.
- Work only in the worktree.

Also repeat: only coordinator commits/pushes/manages PRs; never run workspace-wide checks or build/serve/dev/e2e/package targets. Keep configured Nx one-task/Jest two-worker caps and shared cache. Use the machine-wide FIFO verify lock; do not override cache location or increase caps. Other heavy commands must use `node scripts/verify.mjs --exec --task <name> -- <command> [args...]`. No TUI/VS Code feature/polish work; smallest compatibility edits only, reported explicitly. A missing runtime fixture, account, Electron attachment or permission is a named blocker, not a fabricated pass. Do not change user accounts, permissions or live installs for a measurement. Use isolated fixture roots for destructive tests.

For production batches run scoped Ptah diagnostics after edits, then the ONE batch verification command below from the worktree. `H` below is an exact substitution, not a literal project: `ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,@ptah-extension/cli-engine,ptah-extension-webview`. Every backend/shared batch includes H conservatively to retain dependent-host compatibility; UI batches include Electron and the shared webview host. Confirm actual read-only dependents when assigning, add any demonstrated dependent host missing from the set, never drop one without evidence. Do not run any of these checks during decomposition.

Command sets (expand the named set verbatim into each assignment):

- V-SDK: `npm run verify -- -p @ptah-extension/agent-sdk,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,@ptah-extension/cli-engine,ptah-extension-webview`
- V-SHARED: `npm run verify -- -p @ptah-extension/shared,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,@ptah-extension/cli-engine,ptah-extension-webview`
- V-PLATFORM: `npm run verify -- -p @ptah-extension/platform-core,ptah-cli,ptah-electron,ptah-extension-vscode,ptah-tui,@ptah-extension/cli-engine,ptah-extension-webview`
- V-LANE: `npm run verify -- -p @ptah-extension/cli-agent-runtime,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,@ptah-extension/cli-engine,ptah-extension-webview`
- V-RPC: `npm run verify -- -p @ptah-extension/rpc-handlers,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,@ptah-extension/cli-engine,ptah-extension-webview`
- V-GEN: `npm run verify -- -p @ptah-extension/agent-generation,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,@ptah-extension/cli-engine,ptah-extension-webview`
- V-SYNC: `npm run verify -- -p @ptah-extension/harness-sync,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,@ptah-extension/cli-engine,ptah-extension-webview`
- V-TOOLS: `npm run verify -- -p @ptah-extension/vscode-lm-tools,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,@ptah-extension/cli-engine,ptah-extension-webview`
- V-CHAT: `npm run verify -- -p @ptah-extension/chat,@ptah-extension/webview-e2e-harness,ptah-electron,ptah-extension-webview`
- V-CHATUI: `npm run verify -- -p @ptah-extension/chat-ui,ptah-electron,ptah-extension-webview`
- V-MARKET: `npm run verify -- -p @ptah-extension/marketplace,ptah-electron,ptah-extension-webview`
- V-UI-INTEGRATION: `npm run verify -- -p @ptah-extension/chat-ui,@ptah-extension/marketplace,ptah-electron,ptah-extension-webview`
- V-MIGRATION: `npm run verify -- -p @ptah-extension/rpc-handlers,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,@ptah-extension/cli-engine,ptah-extension-webview`

Every batch report is narrow: return task id, batch number, absolute changed paths, task acceptance evidence (`file:line` and exact test names), risk/assumption disposition, one command/result with exit code and filtered summary, blocked items, and proposed owner follow-ups. Do not paste file dumps or full logs. Return text to coordinator; coordinator retains it as `<task-folder>/reports/batch-N.json` if its runtime requires a report path. Workers never edit task.md or batches.md. A report is not acceptance: coordinator inspects actual files, complete diff and checks. No TODO, PLACEHOLDER, STUB, empty implementation, mock data replacing logic, or logging instead of work.

A producer-consumer boundary is not accepted in isolation: if a bounded edit reveals an immediate dependent compile failure, keep the batch IN_PROGRESS, name the failing caller, and run the already assigned dependent batch sequentially as an integration cohort. Re-run each member's exact scoped command before any member is committed/marked COMPLETE. Never widen a worker's file ownership, install a temporary legacy shim, suppress an error or commit a failing intermediate state to satisfy a batch boundary.

## Phase gates and delivery

- A: Batches 1–8. A0 accepted first. Before A implementation collect ≥3 main + ≥3 subagent baseline samples; after Batch 8 collect the same with identical workspace/provider/account/content/default settings. Require ≥2.5k main median saving. Exercise /code-review default and enabled tool+skill, /loop sleeping + chip, old Workflow/ScheduleWakeup replay, named/proxy start+stream. Electron visual review dark/light against approved prototype.
- B: Batches 9–12. Start only after A shipping acceptance. Baseline is merged A, not original main; target ≥3k main saving. Qualified synced keys must not hide same-name workspace skills; account selection and proxy variants exercised. Electron visual review dark/light against prototype group 3.
- C: Batches 13–16. Before deleting text, independent reviewer checks R1–R36 against base core/preset/partials and records every unique rule's retained home. Final gate: ≥1k main saving, subagent no regression; handshake ≤512, one full substitution table, internal one-shot append unchanged, six effective deny sets unchanged. Manifest generation/check are the approved content operations; run under the verify --exec lock, using only `npm run manifest:generate` and `npm run manifest:check` (no build targets).
- D: Batches 17–41, dispatch order 17–35 → 41 → 36–40 (41 is the compatibility continuation, not a later shipping phase). Baseline is merged C. No token regression; a clean workspace lists fewer irrelevant installs. Every delivery-map change row gets a test, workspace A/B isolation and all proof/rollback/ledger fixtures pass. Electron visual review dark/light against prototype for shared scope/settings/notice; F-D4 additionally requires all four before/after images. Trace every persisted write to its runtime key/scope/value reader and side effects. Release evidence states Electron-first migration timing and v2 rollback caveat.

At the end of EACH shipping phase the coordinator requests ONE independent code-logic review over that phase's combined base-to-head diff, from a family different from all shipping implementers when available. Record actual implementer/reviewer families, review path, verdict, base/head and commit SHAs here; never assume a vendor from old discovery. For new public RPC/tool/schema APIs also request style review; rendered phases A/B/D require visual review. C-3 is spec-only but included in C's combined review, not another code review. No per-batch logic review. Blocking/Serious fixes get at most one fix round; Moderate only for lane-config breakage/data loss, otherwise named follow-up; Minor recorded. One scoped re-review of fixes. No next shipping phase or initial push before accepting independent review and scoped checks. Only coordinator commits in foreground, pushes/PRs in background and watches CI/reviews; no worker Git delivery, merge, rewrite or cleanup.

Phase aggregate commands use the exact sets in implementation-plan.md:1140–1143; include `@ptah-extension/webview-e2e-harness` when A/B fixtures change and `@ptah-extension/platform-core` when A registers settings. These are explicit scoped sets, not workspace-wide. Measurements are first-assistant-turn `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`; retain raw values, transcript paths and medians for ≥3 main + ≥3 identical-agent subagent sessions on EACH side. Missing target/evidence is not an automatic pass.

Phase states: A PENDING review/measurement/visual; B PENDING; C PENDING; D PENDING. No commit or review acceptance is recorded yet.

## Batch 1: A0 runtime assumptions and unchanged Electron evidence — COMPLETE (A0 accepted, decisions #30–#31)

- Recommended executor: CLI lane backend-developer capability for the bounded SDK spike/read-only traces; visual-reviewer subagent for Electron evidence only.
- Execution mode: sequential (spike report, then Electron capture; no production edits).
- Fallback order: other family same capability -> same family other provider/model -> subagent.
- Subagent reason: Electron theme switching, consent-dialog interaction and screenshots require visual interaction unavailable to a code-only lane; do not substitute a browser-only mock.
- Review family: different from implementer at Phase A shipping review; no code review for A0 alone.
- Rationale: falsify runtime assumptions before investing in A/B and preserve base evidence before any UI edit.
- Tasks: 1 | Depends on: none | Phase: A | Phase review: code-logic + style + visual, after Batch 8.

### Task 1.1: Prove assumptions 1–6 and preserve F-D4 BEFORE evidence — IN_PROGRESS

- Inputs: implementation-plan.md:158-175,364-414,938-978,1063-1077; decisions.md #20–27; approved design/prototype; installed SDK declarations and existing first-turn transcript shape.
- Read-only files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-options.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/apps/ptah-electron/src/activation/bootstrap.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/apps/ptah-electron/src/activation/boot-heavy-services.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/harness-sync/src/lib/manifest/plugin-origin-gate.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/harness-sync/src/lib/gitignore/harness-state-store.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/marketplace/src/lib/external-consent-dialog.component.ts`.
- Implementation details: use hand-set A-2-equivalent flag settings for one fresh main, generated subagent, built-in subagent, proxied and named-account route. Observe actual tool schemas and skill listings, including bundled off, qualified synced off, same-name workspace control and a nonexistent qualified key. Named and proxy routes must stream. No production patches, permanent settings writes, dependency upgrade or destructive synced-skill setting.
- Acceptance: separate PASS/FAIL/UNAVAILABLE for all six assumptions with concrete transcript/trace paths. Subagent Workflow/ReportFindings absent; protected scheduling/spawning intact; qualified hiding affects intended account skill only. Confirm bootstrap window ordering, origin gate workspace isolation and `.ptah/` ignore maintenance. Save actual Electron unchanged-dialog dark/light images to `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/.ptah/specs/TASK_2026_853_897f/evidence/f-d4-before-dark.png` and `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/.ptah/specs/TASK_2026_853_897f/evidence/f-d4-before-light.png`; record base SHA, theme, dialog/plugin and capture time. No substitute prototype screenshots. If attached Electron cannot show this base, report blocker; do not run forbidden targets to manufacture it.
- Report: narrow A0 results returned to coordinator for `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/.ptah/specs/TASK_2026_853_897f/reports/batch-1.json`. No credentials/private skill contents in report.

### Batch 1 verification

Runtime evidence only; no changed-project check because no production/test file changes. Subsequent implementation verification set is V-SDK/V-LANE, not executed in A0. Coordinator must accept A0 and retain both BEFORE screenshots before Batch 2 or any F-D4 edit; assumptions 1–3 are hard gates for A/B.

## Batch 2: A-1 static catalog — IMPLEMENTED

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 1 | Phase: A | Phase review: code-logic + style + visual after 8.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: pure policy and its export are one unit.

### Task 2.1: Catalog, dependency policy and protected tools — IMPLEMENTED

- Implementation note (backend-developer): claude-builtin-catalog.ts + spec (6 tools/7 skills, pure sorted policy, protected disjoint, opt-in settings reader); exported from agent-sdk index.

- Plan reference: implementation-plan.md:296-333,342-362; pattern existing builder flag helpers :474-568.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/agent-sdk/src/lib/helpers/claude-builtin-catalog.ts` (new); `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/agent-sdk/src/lib/helpers/claude-builtin-catalog.spec.ts` (new); `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/agent-sdk/src/index.ts`.
- Acceptance/implementation: exact six tool/seven terminal-skill catalog, measured costs, pure sorted/deduped unknown-filtering opt-in policy, both tool+skill needed, catalog ∩ protected empty. Accept synced ids as input but do not implement synced discovery until B. Preserve unrelated exports. A ships groups 1–2 as approved.
- Verification: V-SDK. Report batch-2.json via narrow report contract; retain dependency/protected-tool evidence.

## Batch 3: A-4 shared RPC contracts — IMPLEMENTED

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 2 | Phase: A | Phase review: code-logic + style + visual after 8.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: one public contract owner before producers/consumers.

### Task 3.1: Declare settings and builtin catalog RPC shapes — IMPLEMENTED

- Implementation note (backend-developer): Two opt-in fields on AgentOrchestrationConfig/AgentSetConfigParams; agent:getClaudeBuiltins params/result DTOs, method map and allow-map entry.

- Plan reference: implementation-plan.md:416-453; pattern rpc-agents.types.ts AgentOrchestrationConfig/AgentSetConfigParams.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/shared/src/lib/types/rpc/rpc-agents.types.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/shared/src/lib/types/rpc.types.ts`.
- Acceptance/implementation: two string-array opt-ins, exact tools/terminalSkills/syncedSkills/enabledTools/enabledSkills/policyStatus response, typed method map. Phase A syncedSkills is empty. Keep unrelated RPC entries intact; coordinate immediate producer compile errors as an integration cohort with 7, not stubs.
- Verification: V-SHARED. Report batch-3.json.

## Batch 4: A-4 persisted setting registration and CLI completeness — IMPLEMENTED

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 3 | Phase: A | Phase review: code-logic + style + visual after 8.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: bounded two-project key registration.

### Task 4.1: Register global opt-ins and CLI array keys — IMPLEMENTED

- Implementation note (backend-developer): Both keys registered as global file settings (default []); `ptah agent config-set` CSV-splits them; CLI spec added.

- Plan reference: implementation-plan.md:420-443; pattern file-settings-keys.ts:150,358 and agent-cli.ts:738-770.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/platform-core/src/file-settings-keys.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/apps/ptah-cli/src/cli/commands/agent-cli.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/apps/ptah-cli/src/cli/commands/agent-cli.spec.ts`.
- Acceptance/implementation: default [] and global file persistence for both exact agentOrchestration keys; CLI arrays parse consistently. Trace keys to subsequent builder/lane reads; no workspace-only policy or removal of workflows.disabled.
- Verification: V-PLATFORM (includes changed ptah-cli). Report batch-4.json.

## Batch 5: A-2 main-session policy — IMPLEMENTED

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 2–4 | Phase: A | Phase review: code-logic + style + visual after 8.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: builder and its tests are coupled.

### Task 5.1: Apply defaults on every main launch — IMPLEMENTED

- Implementation note (backend-developer): Builder reads both opt-ins, sets disallowedTools on every route, merges skill denials on verified path only (withClaudeBuiltinSkillDenials); specs for default/opt-in/unverified/proxy/named.
- Review fix R1 (backend-developer, code-logic-review F1, also covers Batch 6 files): a bare `skillOverrides` key hides every same-name skill, so before a verified main session or Ptah CLI spawn emits catalog skill denials, the new `claude-skill-name-discovery.ts` (`guardClaudeBuiltinSkillDenials`) scans workspace (`.claude/skills`, `.claude/commands` in the cwd and parents below home), user (`<claudeConfigDir>/skills|commands`) and plugin (`installed_plugins.json` install paths) skills by directory name or `SKILL.md` frontmatter `name`. The pure rule `withoutCollidingBuiltinSkillDenials` in `claude-builtin-catalog.ts` then drops the colliding denials. An unreadable source makes the result `unknown`, and then no catalog skill denial is emitted, so a user skill is never hidden. The unverified path is unchanged and does no discovery. Wired in `sdk-query-options-builder.ts` (the named route uses its canonical config dir) and `ptah-cli-spawn-options.service.ts`, and exported from `agent-sdk` `index.ts`. Specs: catalog rule, discovery (10 cases), builder `same-name skill guard (R1)`, and spawn builtins `init`/`code-review` across workspace, user and plugin. Verify (`-p @ptah-extension/agent-sdk,@ptah-extension/cli-agent-runtime`, log `/tmp/tpd-fix1-verify.log`): 6/6 tasks succeeded (lint, test, typecheck).
- Review fix R2 (backend-developer, code-logic-review "Re-review R1" N1/N2/N3 and F2 server side). N1: `SKILL.md` frontmatter is parsed with gray-matter (YAML; options object passed to skip its poisoned cache), with a quoted/plain-scalar + `#` comment line reader as fallback when the block is not valid YAML; `gray-matter` added to `agent-sdk` package.json (already a root dependency, same as agent-generation). Spec: `name: "code-review" # reviewer note` under `my-reviewer/`. N2: discovery takes the child's `settingSources` and scans `user` only with `user`, the workspace only with `project`, and plugins when either loads (both tiers can enable a plugin). The builder computes `settingSources` once and passes the same value to the guard and the SDK options; the Ptah CLI spawn takes it through `PtahSpawnSkillScope.settingSources` (the named Claude lane passes its certified sources; ambient spawns keep all three). Specs: proxy route with a user-only `init` keeps the denial; a workspace `init` still drops it; named spawn without `user`. N3: a module-level index per scanned directory (entry names) and per `SKILL.md` (frontmatter name), reused while the stat key (mtime, ctime, size, inode) is unchanged, capped at 2048 paths (cleared, not grown); an unreadable source is still `unknown`, so no built-in skill denial is sent. Specs: an unchanged `SKILL.md` is not reopened, an edited one is, a new skill directory is seen. F2: new atomic `agent:setClaudeBuiltin` (`AgentSetClaudeBuiltinParams`/`Result` in `rpc-agents.types.ts`, registered in `rpc.types.ts` method map and allowlist map; the frozen host-source baseline is not touched, as for `agent:getClaudeBuiltins`). The handler validates with zod, checks the id against the tool or terminal-skill catalog (Phase A has no synced skills), joins the existing `agent:setConfig` chain, reads the stored list, adds or removes only its id, normalizes, writes (the only await) and returns both stored lists; failures return fixed text plus the lists as stored. Specs include two concurrent toggles of different ids that both survive and a toggle racing an in-flight `agent:setConfig`. The CLI `config-set` whole-array path and the frontend component are unchanged. No verify run (coordinator runs the combined verify); targeted tsc log `/tmp/tpd-r2-tsc.log`.
- Review fix R2b (backend-developer, code-logic-review "Re-review R2" N4/N3). N4: a plugin root from `installed_plugins.json` counts only when its id (`name@marketplace`) is `true` in the effective `enabledPlugins` of the loaded tiers (`<claudeConfigDir>/settings.json` for `user`, `<cwd>/.claude/settings.json` for `project`, `<cwd>/.claude/settings.local.json` for `local`; local over project over user, per cwd). A settings file that exists but cannot be read or parsed, or a non-object `enabledPlugins`, makes discovery `unknown` (no built-in skill denials). With no enabled plugin the registry is not read. Specs: disabled and never-enabled installed plugins with `skills/init` leave `init` denied, an enabled one drops it, tier precedence, unparseable/malformed settings are unknown. The plugin fixtures in the builder and spawn builtins specs now enable `p@m` in the user settings. N3: the per-skill `SKILL.md` stats of a directory run in parallel (`Promise.all`); roots were already parallel; the cache is unchanged. Targeted tsc (agent-sdk lib+spec, cli-agent-runtime spec) clean, log `/tmp/tpd-r2b-tsc.log`. No verify run.

- Plan reference: implementation-plan.md:364-397; pattern existing capabilityFlagsFor/isolation/buildFlagSettingsArg.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.spec.ts`.
- Acceptance/implementation: read both opt-ins with [] fallback, apply six disallowed tools on verified/unverified routes, merge terminal denials only on verified path, preserve isolation and sources. Named certification/proxy streaming and canSpawnSubagents remain true. No synced reader yet; internal one-shot query behaviour unchanged.
- Verification: V-SDK. Report batch-5.json, including verified/unverified and ambient/proxy/named matrix.

## Batch 6: A-3 lane policy — IMPLEMENTED

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 2–4 | Phase: A | Phase review: code-logic + style + visual after 8.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: assembly and lane option consumer share one project.

### Task 6.1: Carry policy through lane assembly — IMPLEMENTED

- Implementation note (backend-developer): PtahSpawnAssembly.builtinPolicy from the same settings; lane options set disallowedTools; new builtins + lane-options specs; registry spec fixtures updated.

- Plan reference: implementation-plan.md:399-414; pattern PtahSpawnAssembly and buildClaudeSdkLaneOptions.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-options.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.builtins.spec.ts` (new); `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-options.spec.ts` (new: no existing same-named spec).
- Acceptance/implementation: same settings and pure policy as main; assembly builtinPolicy consumed by lane options; verified-only skill merge, all-route tool denials, named certification, no credentials leaked. Test ambient/named/proxy and unverified policy.
- Verification: V-LANE. Report batch-6.json.

## Batch 7: A-4 RPC implementation and registration — IMPLEMENTED

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 2–4 | Phase: A | Phase review: code-logic + style + visual after 8.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: handler owns reads, validation and writes.

### Task 7.1: Catalog RPC and validated global settings writes — IMPLEMENTED

- Implementation note (backend-developer): agent:getClaudeBuiltins (policyStatus via resolveSessionCapabilityPolicy + SDK_CAPABILITY_RESOLVER); getConfig/setConfig validate, filter, dedupe, sort; registration via AgentRpcHandlers.METHODS manifest.

- Plan reference: implementation-plan.md:416-453; pattern agent:getConfig/setConfig, getAgentCfg/setAgentCfg.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.spec.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`.
- Acceptance/implementation: register read RPC; locate and reuse actual active-workspace capability resolver, never invent verified status. Filter/sort/dedupe string arrays against catalog; failed writes return failure. Phase A syncedSkills []; same response shape as B. Trace write → file setting → next main/lane launch. Existing rpc-allowlist and VS Code rpc-surface checks must pass without weakening them.
- Verification: V-RPC. Report batch-7.json and resolver evidence.

## Batch 8: F-A groups 1–2 — IMPLEMENTED

- Recommended executor: CLI lane frontend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 5–7 | Phase: A | Phase review: code-logic + style + visual due after this batch.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A for code; visual-reviewer interaction required for phase evidence. Review family: different from implementer. Rationale: one card with additive placement and fixture.

### Task 8.1: Implement approved tool and terminal-skill settings card — IMPLEMENTED

- Implementation note (frontend-developer): ClaudeBuiltinsConfigComponent below MCP & Browser (groups 1–2 from agent:getClaudeBuiltins; whole-array saveGeneric + per-item Undo; revert+focus on failed write; load-error/unverified fail-closed; dependency badge; savings rounded to 100); ADV-25 fixture needs EXPECTED_CAPABILITY_COUNT 138→139 (table file outside batch).
- Review fix R1 (frontend-developer, code-logic-review F2/F3): F2: each toggle and Undo now re-reads the stored lists, applies only its own id delta to that fresh list and writes it (concurrent opt-ins from another window or `ptah agent config-set` survive). `saving()` serializes saves, so a second toggle is refused until the first ends. A failed write re-reads and shows the stored state instead of reverting locally. A failed fresh read writes nothing. A failed recovery read shows the load error with Retry, focused. F3: a skill counts as hidden when its checkbox is off or its required tool is off; the component spec and the ADV-25 fixture now assert that turning on `code-review` with `ReportFindings` off leaves the total unchanged. Verify (`-p chat,webview-e2e-harness,ptah-electron,ptah-extension-webview,ptah-extension-vscode`, log `/tmp/tpd-fix23-verify.log`): 51/52 tasks succeeded. The only failure was the known pre-existing `ptah-extension-webview:lint` circular dependency (webview <-> command-center).
- Review fix R2 (frontend-developer, Re-review R1 F2 still open): the read-then-write save is replaced; the R1 fresh-read path no longer exists. Toggle and Undo now each send one atomic `agent:setClaudeBuiltin` `{ kind, id, enabled }` call for that one id, with Undo sending the inverse. No read happens before the write, and `agent:setConfig` is no longer used by this card. On `success: true` with both arrays, the card sets `enabledTools`/`enabledSkills` from the response. On a failure, a throw, or an uncertain result (no success flag, or missing arrays), the card re-reads and shows the stored state. If that read fails, it shows the load error with Retry, focused. `saving()` serialization is unchanged. The spec's concurrent-writer tests are replaced. They now check that only the per-item call is sent (no read, no `setConfig`), that state comes from the response lists, and that Undo sends the inverse call. The ADV-25 fixture gets a stateful `agent:setClaudeBuiltin` responder (`claudeBuiltinsBackend()`). Depends on the backend contract (`AgentSetClaudeBuiltinParams`/`Result` in @ptah-extension/shared, plus the RPC method map entries). Verify not run, by coordinator instruction: the coordinator runs one combined verify.

- Plan reference: implementation-plan.md:455-479; design-spec §1; pattern mcp-port-config.component.ts:401-440.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/chat/src/lib/settings/pro-features/claude-builtins-config.component.ts` (new); `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/chat/src/lib/settings/pro-features/claude-builtins-config.component.spec.ts` (new); `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/chat/src/lib/settings/advanced-settings.component.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/chat/src/lib/settings/advanced-settings.component.spec.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-advanced.entries.ts`.
- Acceptance/implementation: groups 1–2, architect catalog/costs not illustrative rows, global/new-session note, saveGeneric whole arrays + Undo, focus retention, failed write revert, load-error/unverified state, dependency badge and rounded live savings. Fixture only, no e2e target. Do not add group 3 reader before B.
- Verification: V-CHAT. Report batch-8.json. Coordinator then runs Phase A evidence/review/delivery gate before B.

## Batch 9: B synced reader — PENDING

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: Phase A accepted/delivered and A0 qualified override PASS | Phase: B | Phase review: code-logic + visual after 12; style for added exported reader.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: isolated filesystem reader.

### Task 9.1: Discover qualified account skills safely — PENDING

- Plan reference: implementation-plan.md:334-362,158-166; pattern A catalog, existing fs reader conventions.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/agent-sdk/src/lib/helpers/synced-claude-skills.reader.ts` (new); `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/agent-sdk/src/lib/helpers/synced-claude-skills.reader.spec.ts` (new); `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/agent-sdk/src/index.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/agent-sdk/src/lib/helpers/claude-builtin-catalog.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/agent-sdk/src/lib/helpers/claude-builtin-catalog.spec.ts`.
- Acceptance/implementation: manifests/SKILL.md fallback, qualified ids only, account dedupe, malformed/missing/read-error [] + debug, ceil(chars/2.64), mtime cache per config dir, pure policy retains A semantics. Never move/delete synced skill directories or use destructive sync disable setting.
- Verification: V-SDK. Report batch-9.json.

## Batch 10: B main account-aware policy — PENDING

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 9 | Phase: B | Phase review: code-logic + style + visual after 12.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: serialized re-entry into A builder.

### Task 10.1: Read synced policy from effective launch config — PENDING

- Plan reference: implementation-plan.md:364-397 and D-B2/D-B3; pattern A main wiring.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.spec.ts`.
- Acceptance/implementation: named certified launch CLAUDE_CONFIG_DIR first, then effective auth/process config, then home; qualified denials only on verified path; same-name workspace skill remains. Missing discovery nonfatal; preserve A tools, settingSources, capability isolation and named cert.
- Verification: V-SDK. Report batch-10.json.

## Batch 11: B lane account-aware policy — PENDING

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 9 | Phase: B | Phase review: code-logic + style + visual after 12.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: same-account parity between lane and main.

### Task 11.1: Extend lane discovery without policy widening — PENDING

- Plan reference: implementation-plan.md:399-414,1090-1091; pattern Batch 6.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-options.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.builtins.spec.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-options.spec.ts`.
- Acceptance/implementation: launch-specific config-dir synced reader, same verified/unverified qualified policy as main; absent override accepted on proxy; retain A and named certification tests. No generic provider conversion.
- Verification: V-LANE. Report batch-11.json.

## Batch 12: B RPC catalog and settings group 3 — PENDING

- Recommended executor: CLI lane backend/frontend integration capability | Execution mode: sequential | Tasks: 1 | Depends on: 9–11 | Phase: B | Phase review: code-logic + style + visual due.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: existing typed RPC and its card consumer, two projects/four files.

### Task 12.1: Expose account rows and independent persisted opt-ins — PENDING

- Plan reference: implementation-plan.md:416-479,1091; design-spec §1 group 3; pattern Batch 7/8.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.spec.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/chat/src/lib/settings/pro-features/claude-builtins-config.component.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/chat/src/lib/settings/pro-features/claude-builtins-config.component.spec.ts`.
- Acceptance/implementation: discover same effective account ids for get/validation, allow qualified opt-ins, group 3 normal/empty/unverified/load/save/Undo states, summed savings and restart persistence; preserve all A rows/behaviour and same-name workspace skills. Prove settings runtime reader trace.
- Verification: `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/chat,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,@ptah-extension/cli-engine,ptah-extension-webview`. Report batch-12.json. Phase B measurement/visual/independent review due before C.

## Batch 13: C-1 core replacement and dead exports — PENDING

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: B accepted/delivered; independent C inventory check | Phase: C | Phase review: code-logic after 16.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: preserve-rule transformation and exports in one project.

### Task 13.1: Apply R1–R36 without losing unique rules — PENDING

- Plan reference: implementation-plan.md:221-277,481-509; pattern existing prompt constants and budget tests.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.spec.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/agent-sdk/src/lib/prompt-harness/index.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/agent-sdk/src/index.ts`.
- Acceptance/implementation: inventory retained homes, delete MANDATE constant/exports/spec, one substitution table, project verification/commit deferral, no hardcoded nx/commit contradiction, measured budget +5%. Keep server handshake unchanged. No absent docs file creation.
- Verification: V-SDK. Report batch-13.json includes row-by-row retained-home evidence; consumer failures assigned to Batch 14, not suppressed.

## Batch 14: C-1 consumer guarantees — PENDING

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 13 | Phase: C | Phase review: code-logic after 16.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: bounded builder documentation and internal-query proof.

### Task 14.1: Update overlap documentation and pin one-shot append — PENDING

- Plan reference: implementation-plan.md:488-505; pattern existing runner spec and builder JSDoc.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (JSDoc only); `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.spec.ts`.
- Acceptance/implementation: remove outdated paid-twice explanation, assert internal one-shot still appends core; run existing mcp-mandate-manifest/vendor-roster pins and record handshake consumer results at C phase gate. No runtime change to runner or A/B launch policy.
- Verification: V-SDK. Report batch-14.json.

## Batch 15: C-2 hygiene partial deletion and generated manifest — PENDING

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: C inventory gate | Phase: C | Phase review: code-logic after 16.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: deletion, guard and manifest must move together.

### Task 15.1: Retain four inline hygiene homes, delete unused partial — PENDING

- Plan reference: implementation-plan.md:511-529; pattern template-sharing.guard.spec.ts section (j).
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/agent-generation/templates/agents/_shared/engineering-hygiene.md` (delete); `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/agent-generation/src/lib/services/template-partial-resolver.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/agent-generation/src/lib/services/template-sharing.guard.spec.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/content-manifest.json` (generated).
- Acceptance/implementation: remove shared id; compare all four inline blocks to backend role between hygiene/runtime boundaries; reject STATIC references. Generate/check manifest only through npm scripts under verify --exec lock; no hand edits to generated manifest or role templates.
- Verification: V-GEN, plus required locked manifest content operations (not build targets). Report batch-15.json with both manifest script outcomes.

## Batch 16: C-3 least-privilege effective-set regression — PENDING

- Recommended executor: CLI lane senior-tester | Execution mode: sequential | Tasks: 1 | Depends on: C inventory gate; 13–15 before phase closure | Phase: C | Phase review: combined code-logic due, no separate spec-only review.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from shipping implementer. Rationale: single-file test-only owner.

### Task 16.1: Pin six unchanged deny sets and rendered frontmatter — PENDING

- Plan reference: implementation-plan.md:531-556; decision #20; pattern existing exact-row table.
- File: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/agent-generation/src/lib/services/subagent-tool-allowlist.spec.ts`.
- Acceptance/implementation: exact 13 names/order for six named roles, literal unchanged frontmatter and other rows. Never edit production allowlist, shorten public tool names or weaken least privilege to get savings.
- Verification: V-GEN (includes the effective-set tests). Report batch-16.json. Coordinator requests combined C review and completes C targets/handshake/manifest/preserve-list gates before D.

## Batch 17: D-4 sole public contract owner — PENDING

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: C accepted/delivered | Phase: D | Phase review: code-logic + style + visual after 40.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: settle all D shared RPC shapes before consumers.

### Task 17.1: Publish complete scope and notice contracts — PENDING

- Plan reference: implementation-plan.md:650-739,741-800,863-896,1094-1097; pattern existing typed RPC method map and CapabilityScope.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/shared/src/lib/types/rpc.types.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/shared/src/lib/types/rpc/rpc-agents.types.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/shared/src/lib/types/rpc/rpc-plugin-marketplace.types.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/shared/src/lib/types/rpc/rpc-harness.types.ts` (only if scope shape belongs here).
- Acceptance/implementation: workspace/global install params/results, InstalledSkill.scope widening and stale-doc correction, MCP/skills makeGlobal, notice read/dismiss/count/path types, ExternalInstallParams.mcpScope. New optional params preserve source compilation while runtime writers are updated; no permissive enum or deprecated alias. Handoff exact types to every D owner. This owner handles requested later adjustments in these files alone.
- Verification: V-SHARED. Report batch-17.json with producer/consumer map.

## Batch 18: D-1 intent v2 and installer API — PENDING

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 17 | Phase: D | Phase review: code-logic + style + visual after 40.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: persisted producer and direct service consumer, two projects.

### Task 18.1: Store scope-aware records and update installer writes — PENDING

- Plan reference: implementation-plan.md:558-588,752-753; pattern atomicWriteWithRetry and existing install/uninstall service.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/harness-sync/src/lib/sources/mcp-intent-store.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/harness-sync/src/lib/sources/mcp-intent-store.spec.ts` (new); `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-install.service.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-install.service.spec.ts`.
- Acceptance/implementation: exact v2 schema, canonical workspace key, v1 retirement, atomic writes, corrupt/unknown empty never global widening, record/listFor/forget/makeGlobal/scopeOf/listRetired; scoped installer APIs and roundtrip/isolation/merge tests. New workspace record requires root. Do not silently keep legacy global writers active; boundary changes remain IN_PROGRESS until 19/27–29 pass if coupled callers fail.
- Verification: `npm run verify -- -p @ptah-extension/harness-sync,@ptah-extension/cli-agent-runtime,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,@ptah-extension/cli-engine,ptah-extension-webview`. Report batch-18.json.

## Batch 19: D-1/D-2 source resolver boundary — PENDING

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 18; retirement type agreement with 21 before final acceptance | Phase: D | Phase review: code-logic + style + visual after 40.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: resolver is sole source-port producer owner.

### Task 19.1: Filter intents and carry permanent retirement state — PENDING

- Plan reference: implementation-plan.md:571-588,595-605; pattern existing resolve(ws).
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/harness-sync/src/lib/sources/plugin-config-source-resolver.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/harness-sync/src/lib/sources/plugin-config-source-resolver.spec.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/harness-sync/src/lib/sources/harness-source.port.ts`.
- Acceptance/implementation: listFor canonical workspace, global ∪ local target merge, retired source roots/MCP keys on every resolution, A install absent from B manifest. Resolve retirement schema with Batch 21 owner; no second source-port writer or stale list() shim.
- Verification: V-SYNC. Report batch-19.json.

## Batch 20: D-5 selected-default gate — PENDING

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 17 | Phase: D | Phase review: code-logic + style + visual after 40.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: independent one-project default change.

### Task 20.1: Derive exactly currently owned skill slugs — PENDING

- Plan reference: implementation-plan.md:802-810; pattern existing resolve/hasOwnedSkills/persist.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/harness-sync/src/lib/state/skill-sync-gate.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/harness-sync/src/lib/state/skill-sync-gate.spec.ts`.
- Acceptance/implementation: undecided workspace → selected + owned slugs, no entries → selected [], explicit recorded all/selected unchanged. No page redesign, no reset of intentional user preferences.
- Verification: V-SYNC. Report batch-20.json.

## Batch 21: D-2 shared retirement/proof result contracts — PENDING

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 17 | Phase: D | Phase review: code-logic + style + visual after 40.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: shared marker/result definitions plus target-port contract, two projects.

### Task 21.1: Define retirement registry and path-level results — PENDING

- Plan reference: implementation-plan.md:590-648; pattern origin-sidecar constants and HarnessApplyResult/HarnessHealth.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/shared/src/lib/types/origin-sidecar.types.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/shared/src/lib/types/origin-sidecar.types.spec.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/shared/src/lib/types/harness-sync.types.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/harness-sync/src/lib/targets/harness-target.port.ts`.
- Acceptance/implementation: exact retired registry/marker constants and isRetiredSourceRef schema helper, removedRetired/keptRetired reasons and path identity shared by target/reconciler/health/ledger. Reuse exported origin module; no new shared library. Notify 19/22–26/32–35 of exact contract.
- Verification: `npm run verify -- -p @ptah-extension/shared,@ptah-extension/harness-sync,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,@ptah-extension/cli-engine,ptah-extension-webview`. Report batch-21.json.

## Batch 22: D-2 manifest filtering and D-3 local selection exemption — PENDING

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 19,21 | Phase: D | Phase review: code-logic + style + visual after 40.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: sole manifest owner combines both approved edits.

### Task 22.1: Exclude retired clones without hiding workspace roots — PENDING

- Plan reference: implementation-plan.md:603-605,672-676; pattern buildSkills/plugin-origin gate.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/harness-sync/src/lib/manifest/harness-manifest.builder.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/harness-sync/src/lib/manifest/harness-manifest.builder.spec.ts`.
- Acceptance/implementation: retired sourceRef clones inactive regardless of all-mode; exempt only current-workspace skills.sh roots from selection, keep other overlays subject to gate and bundled per-workspace enablement. Tests prove A/B isolation and sourceRefs/retirement, not just count changes.
- Verification: V-SYNC. Report batch-22.json.

## Batch 23: D-2 retirement removal proofs — PENDING

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 19,21–22 | Phase: D | Phase review: code-logic + style + visual after 40.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: actual workspace/MCP deleters must obey one policy.

### Task 23.1: Implement fail-safe target removals — PENDING

- Plan reference: implementation-plan.md:604-638; pattern existing containment/hash removal helpers.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/harness-sync/src/lib/targets/workspace-target.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/harness-sync/src/lib/targets/mcp/mcp-facet-planner.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/harness-sync/src/lib/targets/workspace-target.retirement.spec.ts` (new); `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/harness-sync/src/lib/targets/mcp/mcp-facet-planner.retirement.spec.ts` (new).
- Acceptance/implementation: manifest hash match + real git exit 1/no-match is eligible; 0/128/ENOENT/timeout/other stderr kept/disowned with exact reason; home key needs owned unchanged hash, siblings untouched. Argument-array git 5s, validated contained relative paths, lstat/no links. Edited retired copies never snapshot-remove; I/O failure stays owned and writeFailed for retry. Real-git positive fixture must actually delete untracked unchanged owned copy.
- Verification: V-SYNC. Report batch-23.json, exact destructive/keep fixture matrix.

## Batch 24: D-2 reconciler and health aggregation — PENDING

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 23 | Phase: D | Phase review: code-logic + style + visual after 40.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: target results feed lock-protected reconcile and ledger health.

### Task 24.1: Preserve per-path retirement outcomes across reconcile — PENDING

- Plan reference: implementation-plan.md:604-646; pattern existing idempotency/removal/write-failure suites.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/harness-sync/src/lib/reconciler/harness-reconciler.service.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/harness-sync/src/lib/health/harness-health.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/harness-sync/src/lib/reconciler/harness-reconciler.retirement.spec.ts` (new).
- Acceptance/implementation: pass retirement context into targets, aggregate removed/kept/failed paths accurately, lock retained, disown kept entries, retries retain failed ownership. Include late-discovered workspace and mixed MCP fragment outcome fixtures; don't infer deleted paths from pruned manifests.
- Verification: V-SYNC. Report batch-24.json; handoff result schema/examples to migration owner.

## Batch 25: D-3 metadata, ownership and safe conversion service — PENDING

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 21–24 | Phase: D | Phase review: code-logic + style + visual after 40.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: filesystem transaction and proofs share one service.

### Task 25.1: Scope roots and stage Make global without data loss — PENDING

- Plan reference: implementation-plan.md:650-739; pattern existing skills-sh-source-root service install order.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/rpc-handlers/src/lib/skills-sh/skills-sh-source-root.service.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/rpc-handlers/src/lib/skills-sh/skills-sh-source-root.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/rpc-handlers/src/lib/skills-sh/skills-sh-source-root.service.spec.ts`.
- Acceptance/implementation: workspace/global roots; v1/v2 read; v2 owner+marker+every-file hashes and no extras/links; verifyOwnedRoot shared by conversion/migration. Stage/copy/hash/metadata/rename/propagate/validate/remove-last order; own global collision mismatch refuses; equal hash resumes. Test metadata failure, propagation rejection AND unrefreshed user layer, validation/rollback/removal failures and safe retry with source intact. No directory-name/clone-sidecar root proof.
- Verification: V-RPC. Report batch-25.json with all failure-path evidence and exact helper contract.

## Batch 26: D-3 loader sole owner and Electron mirror guard — PENDING

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 25 | Phase: D | Phase review: code-logic + style + visual after 40.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: sole loader owner includes D-2 skip and D-3 workspace discovery.

### Task 26.1: Keep local roots local and retired roots inactive — PENDING

- Plan reference: implementation-plan.md:601-602,672-676,714-733; pattern existing workspace harness discovery.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.spec.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/apps/ptah-electron/src/activation/plugin-activation.ts` (comment/guard only).
- Acceptance/implementation: permanent retired-id skip all discovery paths; workspaceSkillsSh discovery only active root, not mirror sources; dedupe equal owned global/local retry remnants according to plan. Prove no cross-workspace listing/mirroring, `.ptah/` ignore from A0, existing bundled/generated agent behaviour intact.
- Verification: V-SDK (includes changed Electron). Report batch-26.json; no edits to manifest builder (22 owns it).

## Batch 27: D-3 skills.sh RPC surfaces — PENDING

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 17,25–26 | Phase: D | Phase review: code-logic + style + visual after 40.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: service consumer and RPC/schema tests.

### Task 27.1: Default install to workspace, list/uninstall true scope, expose conversion — PENDING

- Plan reference: implementation-plan.md:654-739; pattern existing skillsSh handlers and propagate single entry point.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/rpc-handlers/src/lib/handlers/skills-sh-rpc.handlers.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/rpc-handlers/src/lib/handlers/skills-sh-rpc.schema.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/rpc-handlers/src/lib/handlers/skills-sh-rpc.handlers.spec.ts`.
- Acceptance/implementation: zod default workspace, no-folder fixed refusal, explicit global, whole-root makeGlobal orchestration using proved helper, scope-resolved uninstall/list; clears retired id only after successful new global install. Preserve active workspace until conversion validation and test retry. No shared contract edits (17 owner).
- Verification: V-RPC. Report batch-27.json.

## Batch 28: D-4 MCP directory and harness apply RPC — PENDING

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 17–19,24 | Phase: D | Phase review: code-logic + style + visual after 40.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: all directory/harness-apply service callers in one project.

### Task 28.1: Validate scope at backend and expose Make global — PENDING

- Plan reference: implementation-plan.md:741-753,774-791; pattern existing RpcUserError and recordInstalledCapability.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.schema.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.spec.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/rpc-handlers/src/lib/harness/io/harness-mcp-install.service.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/rpc-handlers/src/lib/harness/io/harness-mcp-install.service.spec.ts` (new).
- Acceptance/implementation: default workspace, missing-root/home-target refusal before write, installed scope, makeGlobal homeTargets opt-in, harness apply workspace intent, fixed safe errors. recordInstalledCapability unchanged. Store callers use v2 API, no global default leakage.
- Verification: V-RPC. Report batch-28.json.

## Batch 29: D-4 external-plugin MCP consented backend — PENDING

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 17–19,24 | Phase: D | Phase review: code-logic + style + visual after 40.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: five-file external-plugin service/handler boundary.

### Task 29.1: Scope declared servers without failing plugin files — PENDING

- Plan reference: implementation-plan.md:754-773,786-800; pattern current consentToken plan/consent flow.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.schema.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.spec.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/rpc-handlers/src/lib/handlers/external-plugin-mcp.service.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/rpc-handlers/src/lib/handlers/external-plugin-mcp.service.spec.ts`.
- Acceptance/implementation: mcpScope read only consented call; workspace → claude/vscode + detected cursor/opencode, explicit global → existing detected set; no-folder workspace warning/no intent but plugin cache installs; uninstall forgets original scope. Tests prove workspace A absent from B, global choice, warnings. No extra user acknowledgement for settled consent correction.
- Verification: V-RPC. Report batch-29.json.

## Batch 30: D-4 harness tool defaults and schemas — PENDING

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 18,28 | Phase: D | Phase review: code-logic + style + visual after 40.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: public schema and implementation move together.

### Task 30.1: Default harness installs to workspace — PENDING

- Plan reference: implementation-plan.md:775-783; pattern existing HarnessSkillScope and namespace tool handlers.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.spec.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.spec.ts`.
- Acceptance/implementation: createSkill default workspace; installMcpServer workspace/user enum with user→global; workspace+home target refuses; no-folder recovery mentions explicit user. Keep public names and existing enum vocabulary, update descriptions/schema and tests together.
- Verification: V-TOOLS. Report batch-30.json.

## Batch 31: D-4 harness help copy — PENDING

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 30 | Phase: D | Phase review: combined D review after 40.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: two-file help consistency, no extra feature work.

### Task 31.1: Match help to actual scope defaults — PENDING

- Plan reference: implementation-plan.md:780-783; pattern existing help namespace text.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.spec.ts`.
- Acceptance/implementation: help names workspace default and explicit user global; existing unrelated help unchanged. No VS Code-specific polish despite library name.
- Verification: V-TOOLS. Report batch-31.json.

## Batch 32: D-6 orphan reaper path results — PENDING

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 21–26 | Phase: D | Phase review: code-logic + style + visual after 40.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: extend existing proof implementation, not duplicate deletion.

### Task 32.1: Return exact clone deletion/keep paths — PENDING

- Plan reference: implementation-plan.md:827-830,897-898; pattern existing reaper semantics.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/agent-generation/src/lib/services/user-layer/user-layer-orphan-reaper.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/agent-generation/src/lib/services/user-layer/user-layer-reap.spec.ts`.
- Acceptance/implementation: extend results for migration ledger; matching clone sourceHash + nondiverged may delete clone, not its source root; divergence/symlink preserved; no second orphan deletion algorithm.
- Verification: V-GEN. Report batch-32.json and helper/result handoff to 33.

## Batch 33: D-6 migration service and durable ledger — PENDING

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 18–29,32 | Phase: D | Phase review: code-logic + style + visual after 40.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: idempotent state machine and unit fixtures.

### Task 33.1: Retire first, delete only proven artifacts, persist outcomes per path — PENDING

- Plan reference: implementation-plan.md:812-890; pattern existing atomic state writes/reconciler lock and Batch 25 ownership helper.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/rpc-handlers/src/lib/install-scope/install-scope-migration.service.ts` (new); `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/rpc-handlers/src/lib/install-scope/install-scope-migration.service.spec.ts` (new).
- Acceptance/implementation: retire legacy roots/intents, exclude bundled/external/synced, v2 marker+all-hash roots only delete, clones use reaper, reconcile recent∪open existing roots, durable atomic ledger after each delete/keep/reconcile BEFORE next workspace. Counts union persisted paths, retry failed paths/workspaces only, completion only all outcomes/passes, no throw blocking app. Tests cover v1 with matching clone kept/onDisk, edited/extra/markerless/link refusal and idempotence.
- Verification: V-RPC. Report batch-33.json with ledger transition/write→reader trace.

## Batch 34: D-6 independent fixture suite and notice RPC — PENDING

- Recommended executor: CLI lane senior-tester with backend RPC capability | Execution mode: sequential | Tasks: 1 | Depends on: 33 | Phase: D | Phase review: code-logic + style + visual after 40.
- Fallback order: other family same capability -> same family other provider/model -> backend-developer subagent if tester lane cannot implement the tiny real RPC. Subagent reason: capability fallback only, otherwise N/A. Review family: different from production implementer. Rationale: independent failure evidence plus thin read/dismiss boundary.

### Task 34.1: Prove retry counts and implement notice read/dismiss — PENDING

- Plan reference: implementation-plan.md:835-890; pattern existing harness-prefixed read/dismiss handlers.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/rpc-handlers/src/lib/install-scope/install-scope-migration.fixtures.spec.ts` (new); `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/rpc-handlers/src/lib/install-scope/install-scope-notice-rpc.handlers.ts` (new); `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/rpc-handlers/src/lib/install-scope/install-scope-notice-rpc.handlers.spec.ts` (new).
- Acceptance/implementation: two real-git workspaces retired1/removed2 after partial failure+retry, mixed fragments not lost/recounted, hand-added home entries preserved; read null before completion, retired-only visible, persisted until dismissal, seenAt persisted. No service rewriting by tester; defects go to 33 owner. If separate backend lane needed for RPC, it owns two RPC files and tester owns fixture file; never concurrent shared file writes.
- Verification: V-RPC. Report batch-34.json, exact fixture outcomes.

## Batch 35: D-6 shared registration and Electron heavy-boot trigger — PENDING

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 34 and A0 bootstrap trace | Phase: D | Phase review: code-logic + style + visual after 40.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: shared registration and Electron wiring, five files/two projects; Batch 41 separately owns one-project host compatibility.

### Task 35.1: Resolve services in all hosts, invoke only Electron — PENDING

- Plan reference: implementation-plan.md:868-898,1136-1137; pattern register-shared-rpc-handlers and harness DI.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/rpc-handlers/src/lib/harness/di.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.spec.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/apps/ptah-electron/src/activation/boot-heavy-services.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/apps/ptah-electron/src/activation/boot-heavy-services.install-scope.spec.ts` (new).
- Acceptance/implementation: library DI/RPC registration, heavy boot before refreshUserLayer inside caught asynchronous post-window work; window not awaiting migration; no VS Code/CLI invocation. Keep registration ownership in this batch. The separate one-project Batch 41 owns the minimal VS Code expected-resolvable continuation. Dispatch 35 → 41 before accepting the integration cohort; coordinator never writes production compatibility code.
- Verification: V-MIGRATION; rpc-allowlist, rpc-surface/container smoke via expected-resolvable must pass. Report batch-35.json, timing trace and compatibility declaration. No commit until all named checks pass.

## Batch 36: F-D1 shared field, MCP browser and sole inventory-store owner — PENDING

- Recommended executor: CLI lane frontend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 17–19,28–29; BEFORE screenshot pair retained | Phase: D | Phase review: code-logic + style + visual after 40.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A for code. Review family: different from implementer. Rationale: shared field/browser/store integration; six files/two projects.

### Task 36.1: Scope input and inventory mapping for all later rows — PENDING

- Plan reference: implementation-plan.md:900-920; design-spec §2; pattern current MCP browser targets and typed inventory state.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/chat-ui/src/lib/molecules/setup-plugins/install-scope-field.component.ts` (new); `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/chat-ui/src/lib/molecules/setup-plugins/install-scope-field.component.spec.ts` (new); `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.spec.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/marketplace/src/lib/data/marketplace-inventory.store.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/marketplace/src/lib/data/marketplace-inventory.store.spec.ts`.
- Acceptance/implementation: native fieldset/legend/radios, workspace default, no-folder unselected/install-disabled, workspace-only targets and disabled home badges, explicit global seven preselection, remembered home choices, install scope payload. Store includes all skills/MCP/external scopes and conversion calls consumed by 37–39; those workers never edit store. Export field through existing direct import pattern; if a public barrel is mandatory, request bounded ownership continuation rather than silently add a seventh file.
- Verification: V-UI-INTEGRATION. Report batch-36.json with exact component/store API handoff.

## Batch 37: F-D1 installed MCP rows and conversion — PENDING

- Recommended executor: CLI lane frontend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 36 | Phase: D | Phase review: code-logic + style + visual after 40.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: installed rows independent of skills/plugin consent files.

### Task 37.1: Badges and explicit home-target conversion — PENDING

- Plan reference: implementation-plan.md:914-920; decisions #15/#19; pattern installed MCP grouping and installed servers page.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/chat-ui/src/lib/molecules/setup-plugins/installed-mcp-groups.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/chat-ui/src/lib/molecules/setup-plugins/installed-mcp-groups.spec.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/marketplace/src/lib/pages/servers/installed-servers-page.component.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/marketplace/src/lib/pages/servers/installed-servers-page.component.spec.ts`.
- Acceptance/implementation: true scope badges, Make global with three home targets initially unchecked, ordinary intent rows include external-plugin servers, explicit global new installs retain seven preselection but conversion does not. Fixed errors, retry, no reverse conversion.
- Verification: V-UI-INTEGRATION. Report batch-37.json.

## Batch 38: F-D2 skills scope and existing sync copy — PENDING

- Recommended executor: CLI lane frontend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 20,27,36 | Phase: D | Phase review: code-logic + style + visual after 40.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: six-file skills install/list unit; no redesign.

### Task 38.1: Reuse shared scope field for skills and installed rows — PENDING

- Plan reference: implementation-plan.md:922-936; design-spec §2; decision #17.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/chat-ui/src/lib/molecules/setup-plugins/skill-sh-browser.component.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/chat-ui/src/lib/molecules/setup-plugins/skill-sh-browser.component.spec.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-catalog-panel.component.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/marketplace/src/lib/pages/skills/installed-skills-page.component.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/marketplace/src/lib/pages/skills/installed-skill-rows.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/marketplace/src/lib/pages/skills/installed-skill-rows.spec.ts`.
- Acceptance/implementation: existing storefront panel scope field and exact primary copy, no-folder disabled, scope badge/Make global/Available everywhere, whole-root conversion feedback, All of them copy correctly scoped; tests for workspace/global/rollback-facing error/list grouping in listed spec owners. No store edit or skills page redesign; existing installed page spec must still pass unchanged.
- Verification: V-UI-INTEGRATION. Report batch-38.json.

## Batch 39: F-D4 external-plugin consent scope and mandatory correction — PENDING

- Recommended executor: CLI lane frontend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 29,36; hard gate both Batch 1 BEFORE images exist | Phase: D | Phase review: code-logic + style + visual after 40.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A for code; visual-reviewer required for AFTER evidence. Review family: different from implementer. Rationale: existing dialog/caller four-file boundary.

### Task 39.1: Send consented mcpScope and state actual registration behaviour — PENDING

- Plan reference: implementation-plan.md:938-978; decisions #22,#25–27; pattern current consent-token dialog flow.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/marketplace/src/lib/external-consent-dialog.component.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/marketplace/src/lib/external-consent-dialog.component.spec.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/marketplace/src/lib/external-marketplaces.component.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/marketplace/src/lib/external-marketplaces.component.spec.ts`.
- Acceptance/implementation: field only when plan mcpServers nonempty, after server list, legend Install servers for; default workspace; no-folder consent still enabled because files cache installs, help/warning names skipped servers; global only explicit choice; scope sent with token, ignored during plan. Mandatory exact replacement: “Ptah adds these servers to the scope you choose below. Review each command before you continue.” Keep command lines verbatim; remove false NOT register/run claim and assert correction in spec. No new sign-off/prototype/Gate 1.7. Keyboard radios/focus trap verified in Electron.
- Verification: V-MARKET. Report batch-39.json. Visual-reviewer then captures `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/.ptah/specs/TASK_2026_853_897f/evidence/f-d4-after-dark.png` and `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/.ptah/specs/TASK_2026_853_897f/evidence/f-d4-after-light.png`; actual Electron pair must visibly show field+corrected copy and be compared to unchanged Batch 1 pair. Missing pair blocks Phase D completion.

## Batch 40: F-D3 persisted migration notice — PENDING

- Recommended executor: CLI lane frontend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 34–35 | Phase: D | Phase review: code-logic + style + visual due after all 17–40 complete.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A for code. Review family: different from implementer. Rationale: additive card and chat placement.

### Task 40.1: Show final persisted counts until user sees notice — PENDING

- Plan reference: implementation-plan.md:980-989; design-spec §3; pattern existing notification cards and appState navigation.
- Files: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/chat/src/lib/components/molecules/notifications/install-scope-migration-notice.component.ts` (new); `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/chat/src/lib/components/molecules/notifications/install-scope-migration-notice.component.spec.ts` (new); `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`; `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/libs/frontend/chat/src/lib/components/templates/chat-view.component.html`.
- Acceptance/implementation: top region with counts/bullets/details, retired-only notice, completion-before-chat supported, persists across restart until seen; Open Marketplace and Got it both dismiss then correct focus, fixed errors/no raw host error text. Real legacy path example `~/.ptah/plugins/ptah-skillssh-<name>`, never `~/.agents/skills`. No zero/zero suppression of retired-only state.
- Verification: `npm run verify -- -p @ptah-extension/chat,ptah-electron,ptah-extension-webview`. Report batch-40.json. After 17–41 are complete (41 dispatched after 35), coordinator closes every D risk/persisted-write trace/preserve row, measurements, four F-D4 images and prototype dark/light evidence, then requests combined D code-logic/style/visual acceptance and delivery/CI watch. No TASK COMPLETE while any evidence or check is missing.

## Batch 41: D-6 minimal VS Code DI compatibility continuation — PENDING

- Recommended executor: CLI lane backend-developer | Execution mode: sequential | Tasks: 1 | Depends on: 35 | Dispatch: immediately after 35, before 36–40 | Phase: D | Phase review: combined D review after 40, no extra per-batch review.
- Fallback order: other family same capability -> same family other provider/model -> subagent. Subagent reason: N/A. Review family: different from implementer. Rationale: one-file mechanical compatibility edit stays separate from the two-project library/Electron batch.

### Task 41.1: Keep shared service resolution smoke coverage complete — PENDING

- Plan reference: implementation-plan.md:868-896; pattern existing expected-resolvable list.
- File: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet/apps/ptah-extension-vscode/src/di/expected-resolvable.ts`.
- Acceptance/implementation: add newly shared migration/notice service resolution expectations as required by Batch 35 registration; no migration invocation, VS Code feature or polish. Existing container smoke and rpc-surface checks remain strict. Worker reports actual changes; coordinator never supplies a production fix itself.
- Verification: `npm run verify -- -p ptah-extension-vscode,ptah-electron,@ptah-extension/rpc-handlers`. Report batch-41.json. If Batch 35 checks depend on this declaration, 35+41 stay IN_PROGRESS as one integration cohort until both commands pass; only then commit/accept members.
