# Tribunal page retirement: parity inventory

## Summary

- Inventory basis: all 219 tracked candidate paths in `tribunal-refs.txt`; no source files were changed.
- The Tribunal skill and `agent-lanes` skill already implement Council, Forge, Race and Crucible with `ptah_agent_*` lanes; Relay is delegated to orchestration.
- The page is a separate Angular route and Nx library. Its wizard prepares a hidden conductor tab, then ordinary chat sends start the run; it is not a distinct backend execution engine.
- Command Center has a second, page-scoped Tribunal proposal/confirm path and persisted run manifests. Removing its Tribunal entry point does not remove generic Command Center voice, chat or agent monitoring.
- Six of the seven direct page RPC methods have other consumers and must stay. `tasks:getRoundJudge` has no non-page production caller in the candidate search and is the sole page-only RPC.
- The skill text, its shipped mirror, the dedicated harness preset and docs still describe launches from the UI; those references require coordinated edits.
- Skill parity covers the orchestration outcome and cited results, but not the vendor/model wizard, live tile grid, phase rail, run grouping, page close button or Command Center confirm card.
- Decisions below are a deletion proposal for approval, not implementation; no build, tests or e2e were run.

## Capabilities

| Capability | Where today (file:line) | Skill coverage (COVERED/MOVES/REMOVE) | Evidence |
| --- | --- | --- | --- |
| Council deliberation and cited verdict | `libs/frontend/tribunal-panel/src/lib/wizard/step-pick-move.component.ts:299`; `.../step-run.component.ts:41` | COVERED | `.claude/skills/tribunal/SKILL.md:32-36`; `references/council.md:9-12,57-77`; `references/vendor-panel.md:80-84`. |
| Forge isolated implementations and cross-review | `libs/frontend/tribunal-panel/src/lib/wizard/step-pick-move.component.ts:304` | COVERED | Skill `SKILL.md:38-40`; `references/forge.md` flow; lane mechanics in `../agent-lanes/SKILL.md:109-115`. |
| Race attempts, rubric, verified winner | `libs/frontend/tribunal-panel/src/lib/wizard/step-pick-move.component.ts:306` | COVERED | Skill `SKILL.md:42-44`; `references/race.md:24-44`. |
| Crucible executor/judge rounds, frozen rubric and honest stop | `libs/frontend/tribunal-panel/src/lib/wizard/step-crucible-rubric.component.ts`; `.../components/crucible-verdict-panel.component.ts:111-157` | COVERED | Skill `SKILL.md:46-49,61-62`; `references/crucible.md:139-162`. The text result remains; the verdict panel UI is removed. |
| Relay plan/architect/implement/review | `libs/frontend/tribunal-panel/src/lib/wizard/step-role-roster.component.ts:103-173`; `.../components/relay-phase-rail.component.ts:128-153` | MOVES | Skill `SKILL.md:51-53,85-86` routes it to `references/relay.md:1-6` and orchestration lane assignment. Remove UI-launch wording at `references/relay.md:8-15`. |
| Discover vendors, choose family spread | `libs/frontend/tribunal-panel/src/lib/services/tribunal-discovery.service.ts:179-220`; `.../wizard/step-role-roster.component.ts:78-98` | COVERED | Skill `SKILL.md:24-30`; `references/vendor-panel.md:40-62` uses live `ptah_agent_list`. |
| Manually choose each vendor/model, duplicate a vendor, validate role roster | `libs/frontend/tribunal-panel/src/lib/wizard/step-role-roster.component.ts:103-192`; `.../services/tribunal-roster-rules.ts` | MOVES | User can state a pinned roster/model in main chat; skill `references/vendor-panel.md:15-38` handles an explicit panel, but its grammar assumes UI-generated lines. Rewrite for chat-supplied pins and preserve role rules. The picker, validation UI and automatic model catalogue disappear. |
| Show call estimate before launch | `libs/frontend/tribunal-panel/src/lib/wizard/step-run.component.ts:40-48,111-117` | MOVES | Skill `SKILL.md:29`; `references/vendor-panel.md:86-89` requires announcing panel/rounds/call count. Exact page estimate disappears. |
| Prepare hidden conductor, start from its chat | `libs/frontend/tribunal-panel/src/lib/services/tribunal-run.service.ts:40-46,72-99` | MOVES | Main chat invokes the skill directly; `ptah_agent_spawn` stays. No hidden tab, `WorkflowSessionClaimService` claim or first-message preamble needed. |
| Watch individual lane outputs and status | `libs/frontend/tribunal-panel/src/lib/tribunal-page.component.ts:74-85,170-182`; `.../components/conductor-tile.component.ts:43-114` | MOVES | `agent-lanes/SKILL.md:109-115,123-141` covers completion, status and read; main chat transcript and generic agent monitor show work. The live multi-tile grid, drag/resize and focus controls are lost. |
| Refresh Relay/Crucible progress and open artifacts | `libs/frontend/tribunal-panel/src/lib/tribunal-page.component.ts:115-145,274-289`; `.../services/tribunal-progress.service.ts:284-328` | MOVES | Skill `references/relay.md:3-21` and `references/crucible.md:160-174` use task artifacts/reports. Main chat can link/read them; the progress strip, phase rail, refresh button and parsed verdict chip disappear. |
| Cited results and judge report defects | `libs/frontend/tribunal-panel/src/lib/components/crucible-verdict-panel.component.ts:111-157`; `.../services/judge-report.parser.ts:110-125` | COVERED | Skill `references/vendor-panel.md:80-84`; `references/crucible.md:139-162` require cited verdict, defects and artifact links in chat. |
| Run history and workspace switching | `libs/frontend/tribunal-panel/src/lib/services/tribunal-state.service.ts:143-175`; `libs/frontend/command-center/src/lib/components/command-center-projection.source.ts:187-240` | MOVES | Main chat/session history remains; Command Center's special run manifest grouping is page-flow data (`command-center-tribunal.transport.ts:168-173`) and would be removed. The page itself has only a per-workspace active slice, not a dedicated history browser. |
| Close active run / stop lane | `libs/frontend/tribunal-panel/src/lib/tribunal-page.component.ts:64-70,291-293`; `.../services/tribunal-run.service.ts:103-118` | MOVES | Skill lane contract `agent-lanes/SKILL.md:112-115,138-140` exposes `ptah_agent_stop`. Closing the page's hidden tab/reset is removed; it is not the same as stopping every spawned lane. |
| Command Center proposal and Confirm/Decline gate | `libs/frontend/command-center/src/lib/components/command-pending-input.component.ts:44-108`; `.../command-center-roster.provider.ts:384-422` | REMOVE | This separate tagged discovery/proposal/confirm path is defined by `libs/frontend/chat-state/src/lib/command-center-persona.ts:5-32`. Main-chat skill has panel announcement (`SKILL.md:29`) and normal user gates but no equivalent card/nonce/timeout protocol. |
| Tribunal-specific spoken prompt and narration | `libs/frontend/command-center/src/lib/components/command-session-controls.component.ts:34-36`; `.../voice/status-narrator.ts:79` | REMOVE | Generic voice transport and narration remain; the Tribunal intent routing and special spoken status are tied to the Command Center proposal path. |

## RPC and backend

The direct page calls are `ClaudeRpcService.call` calls. String search covered `apps` and `libs` production files, with tests treated as evidence rather than independent users. Generic `chat:start`, `chat:abort`, question delivery and `ptah_agent_*` MCP tools are shared runtime paths, not Tribunal-only RPCs.

| Method/symbol | Defined at | Callers outside the page | Verdict (KEEP/DEAD) |
| --- | --- | --- | --- |
| `provider:listModels` | `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts:596`; contract `libs/shared/src/lib/types/rpc.types.ts:1198` | `libs/frontend/chat/src/lib/settings/providers/providers-models-loader.service.ts:12`, memory diagnostics, skill synthesis | KEEP |
| `agent:listCliModels` | `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:1042`; contract `rpc.types.ts:1401` | providers settings state, skill synthesis, `apps/ptah-cli/src/cli/commands/agent-cli.ts:457-472` | KEEP |
| `agent:getConfig` | `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:491`; contract `rpc.types.ts:1389` | Command Center transport, chat settings, core provider settings, skill synthesis, CLI | KEEP |
| `tasks:create` | `libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts:788`; contract `rpc.types.ts:2393` | Command Center transport, tasks UI, `apps/ptah-cli/src/cli/commands/ptah-spec.ts:285` | KEEP |
| `tasks:get` | `libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts:648`; contract `rpc.types.ts:2384` | tasks UI, chat session task reader, CLI spec command | KEEP |
| `tasks:getRoundJudge` | `libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts:724`; contract `rpc.types.ts:2389` | None found outside `tribunal-progress.service.ts:328` in production call sites | DEAD, subject to confirming no external RPC consumers. The underlying task/report artifacts remain for skill use. |
| `plugins:list-skills` | `libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts:539`; contract `rpc.types.ts:1338` | plugin catalogue, marketplace fixture, CLI plugin command and MCP collector | KEEP |
| `chat:start` / standard send and prompt preamble | shared chat transport; page use `tribunal-run.service.ts:40-46,86-93` | all normal chat surfaces | KEEP; only Tribunal-specific preamble builder is DEAD. |
| `ptah_agent_list/spawn/status/read/message/report/stop` | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:477,1192` and CLI agent runtime | Skill `agent-lanes/SKILL.md:13-16,109-115`; Tribunal `SKILL.md:65-68` | KEEP absolutely, including monitor/session attribution (`session-rpc.handlers.ts:1111`, output-style activation service). |
| Webview route `tribunal`, surface/view id `'tribunal'` | `apps/ptah-extension-webview/src/app/app.routes.ts:185-191`; `libs/shared/src/lib/types/webview-surface.types.ts:54,76` | shell nav, setup hub, e2e ui-driver | DEAD as page identifiers; edit all producers/consumers. |
| `TRIBUNAL_COMPONENT` lazy token | `libs/frontend/core/src/lib/tokens/lazy-view-components.token.ts:15` | none; comment describes already removed token | DEAD reference only; no token exists to delete. |
| `TRIBUNAL_MOVES`, `TribunalMove`, `VendorLane`, `derivePhase`, `rosterIsLaunchable`, `buildTribunalFraming` | `libs/frontend/tribunal-panel/src/phase.ts:1-32` | Command Center intent, proposal, projection, transport and coordinator | DEAD after removing the Command Center Tribunal flow; do not keep a pure entry solely to preserve its imports. |
| `TribunalDiscoveryService` | `libs/frontend/tribunal-panel/src/discovery.ts`; service `.../tribunal-discovery.service.ts:77-220` | Command Center transport | DEAD with page/Command Center path; skill uses `ptah_agent_list`. |
| `COMMAND_CENTER_TRIBUNAL_REQUEST`, `TRIBUNAL_ROSTER_PROPOSAL`, `hasTribunalIntent`, `TribunalRunCoordinator` | `libs/frontend/chat-state/src/lib/command-center-persona.ts:5-32`; `libs/frontend/command-center/src/lib/components/command-center-tribunal-intent.ts:15`; `.../model/tribunal-run-coordinator.ts:72` | only Command Center flow | DEAD under main-chat-only objective. |
| `tribunal-conductor` harness asset/preset | `apps/ptah-extension-vscode/assets/harnesses/tribunal-conductor.json:2`; `libs/backend/rpc-handlers/src/lib/harness/config/builtin-presets.ts:3-30` | generic harness catalogue can expose preset | DEAD as a dedicated Tribunal launch persona; keep generic harness machinery and skill installation. |
| Command Center `CommandCenterRunManifest` | `libs/frontend/chat-state/src/lib/command-center-records.ts:12-24`; writer `.../command-center-tribunal.transport.ts:168-173` | read by Command Center projection; cleanup by tab manager | DEAD as new-run mechanism if proposal path removed. Decide how to display old manifests before deleting storage compatibility. |

## File actions

The table below enumerates every path from `tribunal-refs.txt` (including historical fixtures and mirrored skill copies). `EDIT` is a proposed future code/doc action; this inventory makes no source edit. Files in the Tribunal library that do not literally contain “tribunal” (`tsconfig*.json`, local ESLint config, test setup/stub) also go when the whole library is deleted.

| File | Action (DELETE / EDIT: what / KEEP) | Reason |
| --- | --- | --- |
| `.claude/skills/agent-lanes/SKILL.md` | KEEP | Live lane/orchestration/Tribunal skill content; preserve shipped mirror. |
| `.claude/skills/orchestration/SKILL.md` | KEEP | Live lane/orchestration/Tribunal skill content; preserve shipped mirror. |
| `.claude/skills/orchestration/references/lane-assignment.md` | KEEP | Live lane/orchestration/Tribunal skill content; preserve shipped mirror. |
| `.claude/skills/orchestration/references/task-tracking.md` | KEEP | Live lane/orchestration/Tribunal skill content; preserve shipped mirror. |
| `.claude/skills/tribunal/SKILL.md` | EDIT: remove UI-launch preflight and make chat invocation explicit | Live skill; keep all moves and lane calls. |
| `.claude/skills/tribunal/references/crucible.md` | KEEP | Live lane/orchestration/Tribunal skill content; preserve shipped mirror. |
| `.claude/skills/tribunal/references/forge.md` | KEEP | Live lane/orchestration/Tribunal skill content; preserve shipped mirror. |
| `.claude/skills/tribunal/references/race.md` | KEEP | Live lane/orchestration/Tribunal skill content; preserve shipped mirror. |
| `.claude/skills/tribunal/references/relay.md` | EDIT: replace UI-generated panel/Relay wording with chat pins | Live skill reference, mirrored in shipped plugin. |
| `.claude/skills/tribunal/references/vendor-panel.md` | EDIT: replace UI-generated panel/Relay wording with chat pins | Live skill reference, mirrored in shipped plugin. |
| `.commitlintrc.json` | EDIT: remove tribunal-panel scope | Retired Nx project scope. |
| `.github/ci/test-weights.json` | EDIT: remove tribunal-panel weight | Retired Nx test target. |
| `.gitignore` | KEEP | `.tribunal/` remains the skill's ephemeral worktree directory. |
| `.nxignore` | KEEP | `.tribunal/` remains the skill's ephemeral worktree directory. |
| `README.md` | KEEP | Tribunal concept and docs link remain valid. |
| `apps/ptah-docs/astro.config.mjs` | KEEP | Tribunal skill documentation routes remain valid. |
| `apps/ptah-docs/src/content/docs/agents/agent-orchestration.md` | EDIT: remove page launch/tab claims; link to main-chat skill | Docs describe obsolete navigation. |
| `apps/ptah-docs/src/content/docs/agents/cli-agents.md` | KEEP | Link or skill concept remains valid; review wording during docs pass. |
| `apps/ptah-docs/src/content/docs/agents/index.mdx` | EDIT: remove page launch/tab claims; link to main-chat skill | Docs describe obsolete navigation. |
| `apps/ptah-docs/src/content/docs/canvas/index.md` | KEEP | Link or skill concept remains valid; review wording during docs pass. |
| `apps/ptah-docs/src/content/docs/getting-started/first-launch.md` | EDIT: remove page launch/tab claims; link to main-chat skill | Docs describe obsolete navigation. |
| `apps/ptah-docs/src/content/docs/index.mdx` | KEEP | Link or skill concept remains valid; review wording during docs pass. |
| `apps/ptah-docs/src/content/docs/mcp-and-skills/index.md` | KEEP | Link or skill concept remains valid; review wording during docs pass. |
| `apps/ptah-docs/src/content/docs/mcp-and-skills/popular-skills.md` | KEEP | Link or skill concept remains valid; review wording during docs pass. |
| `apps/ptah-docs/src/content/docs/mcp-and-skills/skills.md` | KEEP | Link or skill concept remains valid; review wording during docs pass. |
| `apps/ptah-docs/src/content/docs/plugins/index.md` | KEEP | Link or skill concept remains valid; review wording during docs pass. |
| `apps/ptah-docs/src/content/docs/plugins/marketplace.md` | KEEP | Link or skill concept remains valid; review wording during docs pass. |
| `apps/ptah-docs/src/content/docs/plugins/skill-selection.md` | KEEP | Link or skill concept remains valid; review wording during docs pass. |
| `apps/ptah-docs/src/content/docs/plugins/skill-toggles.md` | KEEP | Link or skill concept remains valid; review wording during docs pass. |
| `apps/ptah-docs/src/content/docs/providers/kimi-code.md` | KEEP | Link or skill concept remains valid; review wording during docs pass. |
| `apps/ptah-docs/src/content/docs/providers/z-ai.md` | KEEP | Link or skill concept remains valid; review wording during docs pass. |
| `apps/ptah-docs/src/content/docs/setup/index.md` | EDIT: remove page launch/tab claims; link to main-chat skill | Docs describe obsolete navigation. |
| `apps/ptah-docs/src/content/docs/tasks/index.md` | KEEP | Link or skill concept remains valid; review wording during docs pass. |
| `apps/ptah-docs/src/content/docs/tribunal/council.md` | EDIT: explain skill invocation from main chat; remove tab, wizard and harness-picker instructions | Mode documentation survives as skill documentation. |
| `apps/ptah-docs/src/content/docs/tribunal/crucible.md` | EDIT: explain skill invocation from main chat; remove tab, wizard and harness-picker instructions | Mode documentation survives as skill documentation. |
| `apps/ptah-docs/src/content/docs/tribunal/forge.md` | EDIT: explain skill invocation from main chat; remove tab, wizard and harness-picker instructions | Mode documentation survives as skill documentation. |
| `apps/ptah-docs/src/content/docs/tribunal/index.mdx` | EDIT: explain skill invocation from main chat; remove tab, wizard and harness-picker instructions | Mode documentation survives as skill documentation. |
| `apps/ptah-docs/src/content/docs/tribunal/race.md` | EDIT: explain skill invocation from main chat; remove tab, wizard and harness-picker instructions | Mode documentation survives as skill documentation. |
| `apps/ptah-docs/src/content/docs/tribunal/relay.md` | EDIT: explain skill invocation from main chat; remove tab, wizard and harness-picker instructions | Mode documentation survives as skill documentation. |
| `apps/ptah-electron-e2e/src/showcase/dashboard-tour.scene.ts` | EDIT: remove Tribunal tab beat/assertion | Dashboard tour currently points at page navigation. |
| `apps/ptah-electron-e2e/src/showcase/scripts/dashboard-tour.json` | EDIT: remove Tribunal tab beat/assertion | Dashboard tour currently points at page navigation. |
| `apps/ptah-electron-e2e/src/showcase/scripts/tribunal-tour.json` | DELETE | Tours/specs drive the retired page. |
| `apps/ptah-electron-e2e/src/showcase/tribunal-tour.scene.ts` | DELETE | Tours/specs drive the retired page. |
| `apps/ptah-electron-e2e/src/specs/tribunal/tribunal.spec.ts` | DELETE | Tours/specs drive the retired page. |
| `apps/ptah-electron-e2e/src/support/ui-driver.ts` | EDIT: remove tribunal route/surface selector | E2e driver must not address deleted page. |
| `apps/ptah-extension-vscode/assets/harnesses/tribunal-conductor.json` | DELETE | Dedicated conductor harness would remain a second Tribunal launch surface. |
| `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/agent-lanes/SKILL.md` | KEEP | Live lane/orchestration/Tribunal skill content; preserve shipped mirror. |
| `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/SKILL.md` | KEEP | Live lane/orchestration/Tribunal skill content; preserve shipped mirror. |
| `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/references/lane-assignment.md` | KEEP | Live lane/orchestration/Tribunal skill content; preserve shipped mirror. |
| `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/references/task-tracking.md` | KEEP | Live lane/orchestration/Tribunal skill content; preserve shipped mirror. |
| `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/SKILL.md` | EDIT: remove UI-launch preflight and make chat invocation explicit | Live skill; keep all moves and lane calls. |
| `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/references/crucible.md` | KEEP | Live lane/orchestration/Tribunal skill content; preserve shipped mirror. |
| `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/references/forge.md` | KEEP | Live lane/orchestration/Tribunal skill content; preserve shipped mirror. |
| `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/references/race.md` | KEEP | Live lane/orchestration/Tribunal skill content; preserve shipped mirror. |
| `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/references/relay.md` | EDIT: replace UI-generated panel/Relay wording with chat pins | Live skill reference, mirrored in shipped plugin. |
| `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/references/vendor-panel.md` | EDIT: replace UI-generated panel/Relay wording with chat pins | Live skill reference, mirrored in shipped plugin. |
| `apps/ptah-extension-vscode/src/services/webview-html-generator.initial-view.spec.ts` | EDIT: remove retired view in comment/test expectation | Webview initial-view surface list changes. |
| `apps/ptah-extension-vscode/src/services/webview-html-generator.ts` | EDIT: remove retired view in comment/test expectation | Webview initial-view surface list changes. |
| `apps/ptah-extension-webview/src/app/app.routes.ts` | EDIT: remove Tribunal route and routing expectation | Lazy page route and surface provider retire. |
| `apps/ptah-extension-webview/src/app/webview-routing.spec.ts` | EDIT: remove Tribunal route and routing expectation | Lazy page route and surface provider retire. |
| `apps/ptah-video-studio/FOLLOW-UP.md` | EDIT: remove obsolete tribunal-tour recapture step | Production schedule references retired scene. |
| `apps/ptah-video-studio/docs/feature-knowledge-base.md` | EDIT: describe skill-only Tribunal and current moves | Marketing facts currently predate Crucible. |
| `apps/ptah-video-studio/scripts/selfshot-narrate.mjs` | KEEP | Archival narration/segment is not a live page entry point. |
| `apps/ptah-video-studio/selfshot/tribunal-intro/beats.json` | KEEP | Archival narration/segment is not a live page entry point. |
| `content-manifest.json` | KEEP | Manifest must continue shipping Tribunal/agent-lanes/orchestration skills. |
| `e2e-final2.log` | KEEP | Historical log; not product source. |
| `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-output-style.spec.ts` | KEEP | Skill, lane runtime, shared session attribution or historical test; do not delete. |
| `libs/backend/harness-sync/src/lib/targets/skill-sibling-links.spec.ts` | KEEP | Skill, lane runtime, shared session attribution or historical test; do not delete. |
| `libs/backend/output-styles/src/lib/output-style-session-activation.service.ts` | KEEP | Skill, lane runtime, shared session attribution or historical test; do not delete. |
| `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.spec.ts` | KEEP | Skill, lane runtime, shared session attribution or historical test; do not delete. |
| `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts` | KEEP | Skill, lane runtime, shared session attribution or historical test; do not delete. |
| `libs/backend/rpc-handlers/src/lib/harness/config/builtin-presets.ts` | EDIT: remove dedicated tribunal-conductor preset only | Generic harness presets remain; dedicated persona is another launch entry. |
| `libs/backend/rpc-handlers/src/lib/harness/io/harness-skill-install.service.spec.ts` | KEEP | Skill, lane runtime, shared session attribution or historical test; do not delete. |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/lane-rule-single-home.spec.ts` | KEEP | Skill, lane runtime, shared session attribution or historical test; do not delete. |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/skill-description-shape.spec.ts` | KEEP | Skill, lane runtime, shared session attribution or historical test; do not delete. |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/vendor-roster-drift.spec.ts` | KEEP | Skill, lane runtime, shared session attribution or historical test; do not delete. |
| `libs/frontend/canvas/src/lib/canvas-layout.service.spec.ts` | KEEP | Generic tile geometry remains; Tribunal comment/test name can be refreshed. |
| `libs/frontend/canvas/src/lib/canvas-layout.service.ts` | KEEP | Generic tile geometry remains; Tribunal comment/test name can be refreshed. |
| `libs/frontend/chat-routing/src/lib/stream-router.service.ts` | EDIT: remove obsolete conductor-claim comments/test cases; retain generic routing | Shared surface ownership still needed by other workflows. |
| `libs/frontend/chat-routing/src/lib/stream-router.setup-surfaces.spec.ts` | EDIT: remove obsolete conductor-claim comments/test cases; retain generic routing | Shared surface ownership still needed by other workflows. |
| `libs/frontend/chat-state/src/index.ts` | EDIT: remove tagged Tribunal persona contract/exports/tests | Generic Command Center persona remains. |
| `libs/frontend/chat-state/src/lib/command-center-persona.spec.ts` | EDIT: remove tagged Tribunal persona contract/exports/tests | Generic Command Center persona remains. |
| `libs/frontend/chat-state/src/lib/command-center-persona.ts` | EDIT: remove tagged Tribunal persona contract/exports/tests | Generic Command Center persona remains. |
| `libs/frontend/chat-state/src/lib/tab-manager.lifecycle.spec.ts` | KEEP | Generic session lifecycle regression remains useful; test name/comment can be refreshed. |
| `libs/frontend/chat-state/src/lib/tab-manager.service.ts` | EDIT: update retired conductor comments, retain generic tab manager | Shared session handling must stay. |
| `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts` | EDIT: refresh obsolete conductor comments only; retain behavior | Generic permission, turn and preamble paths remain in use. |
| `libs/frontend/chat-streaming/src/lib/turn-state-applier.service.ts` | EDIT: refresh obsolete conductor comments only; retain behavior | Generic permission, turn and preamble paths remain in use. |
| `libs/frontend/chat-types/src/lib/chat-types.ts` | EDIT: refresh obsolete conductor comments only; retain behavior | Generic permission, turn and preamble paths remain in use. |
| `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/prompt-catalogue.ts` | KEEP | /tribunal prompt invokes the retained skill from chat. |
| `libs/frontend/chat/src/lib/components/organisms/execution/workflow-card.component.ts` | KEEP | Only explanatory comment, sample session id or generic settings behavior; optional wording cleanup. |
| `libs/frontend/chat/src/lib/components/templates/app-shell.component.html` | EDIT: remove Tribunal nav/view assertions | Deleted view id otherwise breaks compilation or tests. |
| `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts` | EDIT: remove Tribunal nav/view assertions | Deleted view id otherwise breaks compilation or tests. |
| `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` | KEEP | Only explanatory comment, sample session id or generic settings behavior; optional wording cleanup. |
| `libs/frontend/chat/src/lib/components/templates/electron-shell.apps-tab.spec.ts` | EDIT: remove Tribunal nav/view assertions | Deleted view id otherwise breaks compilation or tests. |
| `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts` | EDIT: remove Tribunal nav/view assertions | Deleted view id otherwise breaks compilation or tests. |
| `libs/frontend/chat/src/lib/components/templates/electron-shell.config-gate.spec.ts` | EDIT: remove Tribunal nav/view assertions | Deleted view id otherwise breaks compilation or tests. |
| `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts` | KEEP | Only explanatory comment, sample session id or generic settings behavior; optional wording cleanup. |
| `libs/frontend/chat/src/lib/services/message-sender.service.ts` | KEEP | Only explanatory comment, sample session id or generic settings behavior; optional wording cleanup. |
| `libs/frontend/chat/src/lib/services/workspace-coordinator.service.spec.ts` | EDIT: remove Tribunal nav/view assertions | Deleted view id otherwise breaks compilation or tests. |
| `libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts` | KEEP | Only explanatory comment, sample session id or generic settings behavior; optional wording cleanup. |
| `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts` | KEEP | Only explanatory comment, sample session id or generic settings behavior; optional wording cleanup. |
| `libs/frontend/chat/src/lib/settings/settings.component.spec.ts` | KEEP | Only explanatory comment, sample session id or generic settings behavior; optional wording cleanup. |
| `libs/frontend/chat/src/lib/settings/settings.component.ts` | KEEP | Only explanatory comment, sample session id or generic settings behavior; optional wording cleanup. |
| `libs/frontend/chat/src/lib/tokens/session-context.token.ts` | KEEP | Only explanatory comment, sample session id or generic settings behavior; optional wording cleanup. |
| `libs/frontend/command-center/src/lib/components/command-center-page.component.spec.ts` | EDIT: remove Tribunal-only branches/tests, preserve generic agents, voice, scene and pending input | Shared Command Center feature with page-specific branches. |
| `libs/frontend/command-center/src/lib/components/command-center-page.component.ts` | EDIT: remove Tribunal-only branches/tests, preserve generic agents, voice, scene and pending input | Shared Command Center feature with page-specific branches. |
| `libs/frontend/command-center/src/lib/components/command-center-page.controller.spec.ts` | EDIT: remove Tribunal-only branches/tests, preserve generic agents, voice, scene and pending input | Shared Command Center feature with page-specific branches. |
| `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts` | EDIT: remove Tribunal-only branches/tests, preserve generic agents, voice, scene and pending input | Shared Command Center feature with page-specific branches. |
| `libs/frontend/command-center/src/lib/components/command-center-projection.source.spec.ts` | EDIT: remove Tribunal-only branches/tests, preserve generic agents, voice, scene and pending input | Shared Command Center feature with page-specific branches. |
| `libs/frontend/command-center/src/lib/components/command-center-projection.source.ts` | EDIT: remove Tribunal-only branches/tests, preserve generic agents, voice, scene and pending input | Shared Command Center feature with page-specific branches. |
| `libs/frontend/command-center/src/lib/components/command-center-roster.provider.spec.ts` | DELETE | Dedicated Tribunal proposal/confirm pipeline; no main-chat use. |
| `libs/frontend/command-center/src/lib/components/command-center-roster.provider.ts` | DELETE | Dedicated Tribunal proposal/confirm pipeline; no main-chat use. |
| `libs/frontend/command-center/src/lib/components/command-center-tribunal-intent.spec.ts` | DELETE | Dedicated Tribunal proposal/confirm pipeline; no main-chat use. |
| `libs/frontend/command-center/src/lib/components/command-center-tribunal-intent.ts` | DELETE | Dedicated Tribunal proposal/confirm pipeline; no main-chat use. |
| `libs/frontend/command-center/src/lib/components/command-center-tribunal.transport.spec.ts` | DELETE | Dedicated Tribunal proposal/confirm pipeline; no main-chat use. |
| `libs/frontend/command-center/src/lib/components/command-center-tribunal.transport.ts` | DELETE | Dedicated Tribunal proposal/confirm pipeline; no main-chat use. |
| `libs/frontend/command-center/src/lib/components/command-node-detail.component.ts` | EDIT: remove Tribunal-only branches/tests, preserve generic agents, voice, scene and pending input | Shared Command Center feature with page-specific branches. |
| `libs/frontend/command-center/src/lib/components/command-overlay.component.ts` | EDIT: remove Tribunal-only branches/tests, preserve generic agents, voice, scene and pending input | Shared Command Center feature with page-specific branches. |
| `libs/frontend/command-center/src/lib/components/command-pending-input.component.spec.ts` | EDIT: remove Tribunal-only branches/tests, preserve generic agents, voice, scene and pending input | Shared Command Center feature with page-specific branches. |
| `libs/frontend/command-center/src/lib/components/command-pending-input.component.ts` | EDIT: remove Tribunal-only branches/tests, preserve generic agents, voice, scene and pending input | Shared Command Center feature with page-specific branches. |
| `libs/frontend/command-center/src/lib/components/command-session-controls.component.spec.ts` | EDIT: remove Tribunal-only branches/tests, preserve generic agents, voice, scene and pending input | Shared Command Center feature with page-specific branches. |
| `libs/frontend/command-center/src/lib/components/command-session-controls.component.ts` | EDIT: remove Tribunal-only branches/tests, preserve generic agents, voice, scene and pending input | Shared Command Center feature with page-specific branches. |
| `libs/frontend/command-center/src/lib/integration/delegation-and-status.spec.ts` | EDIT: remove Tribunal-only branches/tests, preserve generic agents, voice, scene and pending input | Shared Command Center feature with page-specific branches. |
| `libs/frontend/command-center/src/lib/integration/integration-harness.testing.ts` | EDIT: remove Tribunal transport fixture | Integration harness retains generic delegation tests. |
| `libs/frontend/command-center/src/lib/integration/tribunal-confirm-gate.spec.ts` | DELETE | Dedicated Tribunal proposal/confirm pipeline; no main-chat use. |
| `libs/frontend/command-center/src/lib/model/command-center.store.ts` | EDIT: remove Tribunal-only branches/tests, preserve generic agents, voice, scene and pending input | Shared Command Center feature with page-specific branches. |
| `libs/frontend/command-center/src/lib/model/tribunal-roster-proposal.contract.spec.ts` | DELETE | Dedicated Tribunal proposal/confirm pipeline; no main-chat use. |
| `libs/frontend/command-center/src/lib/model/tribunal-roster-proposal.spec.ts` | DELETE | Dedicated Tribunal proposal/confirm pipeline; no main-chat use. |
| `libs/frontend/command-center/src/lib/model/tribunal-roster-proposal.ts` | DELETE | Dedicated Tribunal proposal/confirm pipeline; no main-chat use. |
| `libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.spec.ts` | DELETE | Dedicated Tribunal proposal/confirm pipeline; no main-chat use. |
| `libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.ts` | DELETE | Dedicated Tribunal proposal/confirm pipeline; no main-chat use. |
| `libs/frontend/command-center/src/lib/model/work-projection.spec.ts` | EDIT: remove Tribunal-only branches/tests, preserve generic agents, voice, scene and pending input | Shared Command Center feature with page-specific branches. |
| `libs/frontend/command-center/src/lib/model/work-projection.ts` | EDIT: remove Tribunal-only branches/tests, preserve generic agents, voice, scene and pending input | Shared Command Center feature with page-specific branches. |
| `libs/frontend/command-center/src/lib/scene/command-scene-status.ts` | EDIT: remove Tribunal-only branches/tests, preserve generic agents, voice, scene and pending input | Shared Command Center feature with page-specific branches. |
| `libs/frontend/command-center/src/lib/scene/command-scene.component.ts` | EDIT: remove Tribunal-only branches/tests, preserve generic agents, voice, scene and pending input | Shared Command Center feature with page-specific branches. |
| `libs/frontend/command-center/src/lib/scene/scene-layout.spec.ts` | EDIT: remove Tribunal-only branches/tests, preserve generic agents, voice, scene and pending input | Shared Command Center feature with page-specific branches. |
| `libs/frontend/command-center/src/lib/scene/scene-layout.ts` | EDIT: remove Tribunal-only branches/tests, preserve generic agents, voice, scene and pending input | Shared Command Center feature with page-specific branches. |
| `libs/frontend/command-center/src/lib/scene/sprite-cache.ts` | EDIT: remove Tribunal-only branches/tests, preserve generic agents, voice, scene and pending input | Shared Command Center feature with page-specific branches. |
| `libs/frontend/command-center/src/lib/voice/status-narrator.spec.ts` | EDIT: remove Tribunal-only branches/tests, preserve generic agents, voice, scene and pending input | Shared Command Center feature with page-specific branches. |
| `libs/frontend/command-center/src/lib/voice/status-narrator.ts` | EDIT: remove Tribunal-only branches/tests, preserve generic agents, voice, scene and pending input | Shared Command Center feature with page-specific branches. |
| `libs/frontend/core/src/lib/services/app-state.service.spec.ts` | EDIT: replace Tribunal view fixtures | Deleted view union makes these tests invalid. |
| `libs/frontend/core/src/lib/services/app-state.service.ts` | EDIT: update obsolete Tribunal comments only; retain generic app state/token | No live Tribunal lazy token exists. |
| `libs/frontend/core/src/lib/tokens/lazy-view-components.token.ts` | EDIT: update obsolete Tribunal comments only; retain generic app state/token | No live Tribunal lazy token exists. |
| `libs/frontend/dashboard/src/lib/components/dashboard-grid/dashboard-grid.layout.spec.ts` | KEEP | Negative dashboard-layout assertion remains true. |
| `libs/frontend/harness-builder/src/lib/components/setup-hub.component.ts` | EDIT: retarget Setup Hub Tribunal card to main chat/skill | Current card navigates to deleted view. |
| `libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.ts` | EDIT: replace source comments that cite deleted Tribunal state file | Independent apps state remains. |
| `libs/frontend/mcp-apps-page/src/lib/services/apps-workspace-slice.ts` | EDIT: replace source comments that cite deleted Tribunal state file | Independent apps state remains. |
| `libs/frontend/tribunal-panel/jest.config.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/package.json` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/project.json` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/discovery.spec.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/discovery.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/index.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/components/conductor-tile.component.spec.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/components/conductor-tile.component.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/components/crucible-verdict-panel.component.spec.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/components/crucible-verdict-panel.component.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/components/relay-phase-rail.component.spec.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/components/relay-phase-rail.component.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/components/tribunal-empty-state.component.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/components/vendor-card.component.spec.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/components/vendor-card.component.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/services/judge-report.parser.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/services/spec-documents.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/services/tribunal-discovery.service.spec.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/services/tribunal-discovery.service.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/services/tribunal-estimate.spec.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/services/tribunal-estimate.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/services/tribunal-phase-derivation.spec.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/services/tribunal-phase-derivation.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/services/tribunal-progress.service.spec.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/services/tribunal-progress.service.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/services/tribunal-roster-rules.spec.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/services/tribunal-roster-rules.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/services/tribunal-run-framing.spec.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/services/tribunal-run-framing.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/services/tribunal-run.service.spec.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/services/tribunal-run.service.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/services/tribunal-state.service.spec.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/services/tribunal-state.service.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/tribunal-page.component.spec.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/tribunal-page.component.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/tribunal-tile-host.component.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/types/tribunal-ui.types.spec.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/types/tribunal-ui.types.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/wizard/step-crucible-rubric.component.spec.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/wizard/step-crucible-rubric.component.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/wizard/step-panel-preview.component.spec.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/wizard/step-panel-preview.component.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/wizard/step-pick-move.component.spec.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/wizard/step-pick-move.component.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/wizard/step-role-roster.component.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/wizard/step-run.component.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/wizard/tribunal-wizard.component.spec.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/lib/wizard/tribunal-wizard.component.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/phase.spec.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/frontend/tribunal-panel/src/phase.ts` | DELETE | Entire page-only Nx library, including pure exports once Command Center imports are removed. |
| `libs/shared/src/lib/providers/entries/claude-cli-provider-entry.ts` | EDIT: replace obsolete panel example in comment | Provider mapping remains required. |
| `libs/shared/src/lib/types/rpc/rpc-harness.types.spec.ts` | KEEP | Task-spec Crucible contract and skill-selection tests remain valid. |
| `libs/shared/src/lib/types/task-spec.contract.ts` | KEEP | Task-spec Crucible contract and skill-selection tests remain valid. |
| `libs/shared/src/lib/types/webview-surface.types.spec.ts` | EDIT: remove tribunal surface id and test expectation | Deleted route cannot remain a valid surface. |
| `libs/shared/src/lib/types/webview-surface.types.ts` | EDIT: remove tribunal surface id and test expectation | Deleted route cannot remain a valid surface. |
| `libs/web/landing/src/lib/console/council-demo.component.ts` | EDIT: reframe staged Council visual as skill/chat demo | Marketing frame should not imply the retired page exists. |
| `libs/web/landing/src/lib/sections/hero/hero-device-showcase.component.ts` | EDIT: reframe staged Council visual as skill/chat demo | Marketing frame should not imply the retired page exists. |
| `nx.json` | EDIT: remove tribunal-panel path inputs | Nx no longer has that project. |
| `tools/degradation-audit/baseline.json` | EDIT: remove retired project baseline row when refreshing audit | Generated baseline references deleted library. |
| `tools/hyperframes/kits/ptah-ui/SPEC.md` | EDIT: remove mock Tribunal app tab or relabel skill demo | Design kit currently models a retired tab. |
| `tools/hyperframes/kits/ptah-ui/src/app-window.html` | EDIT: remove mock Tribunal app tab or relabel skill demo | Design kit currently models a retired tab. |
| `tools/mcp-bench/fixtures/memory-skills/memory-facts.v1.jsonl` | KEEP | Historical benchmark facts/fixtures are not live UI; preserve reproducibility. |
| `tools/mcp-bench/fixtures/memory-skills/merge-pairs.v1.jsonl` | KEEP | Historical benchmark facts/fixtures are not live UI; preserve reproducibility. |
| `tools/mcp-bench/fixtures/memory-skills/planted-negatives.v1/index.json` | KEEP | Historical benchmark facts/fixtures are not live UI; preserve reproducibility. |
| `tools/mcp-bench/fixtures/memory-skills/planted-negatives.v1/pn-07.md` | KEEP | Historical benchmark facts/fixtures are not live UI; preserve reproducibility. |
| `tools/mcp-bench/fixtures/memory-skills/skill-triggers.v2.jsonl` | KEEP | Historical benchmark facts/fixtures are not live UI; preserve reproducibility. |
| `tools/mcp-bench/questions/7910f34cf/dependents.json` | KEEP | Historical benchmark facts/fixtures are not live UI; preserve reproducibility. |
| `tools/mcp-bench/questions/7910f34cf/file-tools.json` | KEEP | Historical benchmark facts/fixtures are not live UI; preserve reproducibility. |
| `tools/mcp-bench/questions/7910f34cf/references.json` | KEEP | Historical benchmark facts/fixtures are not live UI; preserve reproducibility. |
| `tools/mcp-bench/questions/7910f34cf/relevance.json` | KEEP | Historical benchmark facts/fixtures are not live UI; preserve reproducibility. |
| `tools/mcp-bench/questions/7910f34cf/symbols-exact.json` | KEEP | Historical benchmark facts/fixtures are not live UI; preserve reproducibility. |
| `tsconfig.base.json` | EDIT: remove three tribunal-panel aliases | No remaining import may target deleted library. |+

## Chat lib overlap

An open branch edits `libs/frontend/chat`. Keep the following required edits narrow and coordinate them with that branch:

| Chat file | Required? | Change |
| --- | --- | --- |
| `components/templates/app-shell.component.html` | Required | Remove VS Code Tribunal nav button (§ line 178-187). |
| `components/templates/app-shell.component.ts` | Required | Remove `openTribunal()` at 344-345 and update route comment. |
| `components/templates/electron-shell.component.ts` | Required | Remove Electron Tribunal tab at 275-282 and `openTribunal()` at 662-664. |
| `components/templates/electron-shell.apps-tab.spec.ts`, `electron-shell.config-gate.spec.ts` | Required for scoped tests | Update tab-order assertions. |
| `services/workspace-coordinator.service.spec.ts` | Required for compilation after removing view union | Replace `'tribunal'` fixtures/assertions with another valid standalone view while retaining workspace-switch coverage. |
| `components/templates/chat-view.component.ts`, `components/organisms/execution/workflow-card.component.ts`, `services/message-sender.service.ts`, `services/workspace-coordinator.service.ts`, `tokens/session-context.token.ts` | Optional | Refresh conductor/tile comments; generic behavior must remain. |
| `settings/providers/providers-settings.component.ts`, `settings/settings.component.ts`, `settings/settings.component.spec.ts`, `services/chat-store/session-loader.service.spec.ts` | Optional | Refresh outdated Tribunal examples; no live page import. |

## Proposed Removals

1. Dedicated Tribunal navigation tab/page and the Setup Hub launch card navigation, in both VS Code and Electron.
2. Wizard controls for move, vendor and exact model selection, role-slot validation, Crucible rubric entry and paid-turn estimate. Main chat will accept user pins and rubric text, but has no equivalent form.
3. Dedicated conductor pane and live panelist tile grid, including focus, lock, drag and resize controls.
4. Visual Relay phase rail, Crucible verdict chip/defect panel and manual progress refresh. Skill chat reports and task artifacts continue.
5. Page Close Tribunal action that closes the hidden tab and resets its per-workspace active run slice. Explicit lane stop remains available through `ptah_agent_stop`.
6. Command Center's tagged Tribunal discovery request, paid-run Confirm/Decline card, nonce/timeout handling, special voice prompts and persisted run grouping. Generic Command Center voice and agent cards remain.
7. Dedicated `tribunal-conductor` harness asset/builtin preset and its harness-picker launch guidance, if the requirement means the skill is the sole invocation path.
8. Tribunal page showcase scene and page-specific e2e spec. Existing recordings are historical artifacts and should not be presented as current UI.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Sole entry point | Main chat skill vs retain page/Command Center launch | User objective; skill `SKILL.md:24-68`; route `app.routes.ts:185-191`; Command Center `command-center-page.controller.ts:452-462` | Yes, via future UI feature, but deletion loses current form controls. |
| Keep lane runtime | Preserve `ptah_agent_*` and shared chat/session/monitor paths vs prune with page | `agent-lanes/SKILL.md:109-115`; MCP dispatcher `protocol-dispatcher.ts:477,1192`; `session-rpc.handlers.ts:1111` | No practical alternative; required for skill. |
| RPC cleanup | Retain shared RPCs; retire `tasks:getRoundJudge` only after external-consumer check | Other call sites in RPC table; only production `tasks:getRoundJudge` call at `tribunal-progress.service.ts:328` | Yes, RPC can be restored if external client needs it. |
| Explicit roster | Adapt skill to accept chat pins vs keep UI-line grammar | `vendor-panel.md:15-38` recognizes `[tribunal:<laneId>]` UI lines; default selection at 54-62 | Yes; skill wording can be revised independently. |
| Relay | Route from chat to orchestration vs retire Relay entirely | `SKILL.md:51-53`; `references/relay.md:1-6` | Yes; keep Relay semantics and docs. |
| Harness preset | Delete dedicated preset/asset vs keep as alternate harness launch | `builtin-presets.ts:3-30`; `assets/harnesses/tribunal-conductor.json:2` | Yes; preserve generic harness system. |
| Run history | Remove Command Center run-manifest UI and preserve generic transcripts vs migrate old manifests to a read-only display | Writer is Tribunal transport `...transport.ts:168-173`; reader `...projection.source.ts:187-240` | Partly: stored historical data should not be discarded silently. |
| Docs/marketing | Keep `/tribunal/` docs as skill guide and update launch instructions vs delete docs | Skill references and docs sidebar still valid; docs `tribunal/index.mdx:68-79` describes obsolete tab | Yes. |

## Open questions

1. Does “only through the skill from main chat” also prohibit the generic harness picker from offering the dedicated Tribunal Conductor preset? This inventory proposes removing it; the skill itself stays selectable.
2. Should existing Command Center run manifests remain readable as historical records after new Tribunal proposals stop, or may their special projection be removed immediately? The current writer has only the Command Center Tribunal transport; generic chat history remains.
3. Should the landing-page staged Council visual remain as an illustration of the skill, or be replaced with an actual main-chat mockup? Either way its current product framing needs review.
4. Is there a supported external RPC client using `tasks:getRoundJudge`? Repo production string search found none outside the page; public RPC contracts may still be consumed externally.
5. Is direct user roster pinning (including duplicate vendor/model lanes) a required parity promise? The existing skill documents exact pins only in UI-generated syntax, so main-chat wording needs an explicit contract.

