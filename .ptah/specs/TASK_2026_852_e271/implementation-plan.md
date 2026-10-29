# Implementation plan: retire the Tribunal page

## Scope

Retire the separate Tribunal route, Angular library, navigation and Setup Hub entry points, wizard, conductor/tile UI, phase rail, verdict chip, close action, Command Center Tribunal proposal/confirmation/voice/run grouping, dedicated harness preset, page tour and page e2e spec. These are all eight approved removals in `context.md`. Council, Forge, Race, Crucible and Relay remain available from **main chat through the `tribunal` skill** and `ptah_agent_*` lanes; Relay delegates its phases to orchestration. Electron is the priority host, and Electron, VS Code, webview, CLI and TUI must typecheck after the change.

Delete `tribunal-conductor` from the asset and built-in preset list. Delete only the `tasks:getRoundJudge` RPC surface (handler, contract, allowlist, host-source baseline and RPC-specific tests); keep the underlying task/report artifact contract and lane runtime. Preserve `CommandCenterRunManifest` storage types, `command-center-records.ts`, and `tab-manager.service.ts` cleanup unchanged so existing records can still be read/cleaned up. Remove new-run grouping/projection, as approved. The skill must accept **plain-text roster pins from main chat**, including duplicate vendors/models, resolve them against `ptah_agent_list`, and confirm the resolved panel and call count with the user before spawning.

Do **not** edit these files because `fix/lane-chat-order` overlaps them:

- `libs/frontend/chat-state/src/lib/tab-manager.service.ts`
- `libs/frontend/chat/src/lib/services/message-sender.service.ts`
- `libs/frontend/chat/src/lib/tokens/session-context.token.ts`
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts`

Also keep generic `chat:start`/abort, provider/model discovery, task create/get, plugin skill listing, `ptah_agent_*`, agent monitoring, generic Command Center voice and questions, and skill installation. Keep `.tribunal/` ignores in `.gitignore` and `.nxignore`; those are skill worktrees. The authoritative 219-path inventory is `parity-inventory.md`, especially **File actions**; this plan names changes and deliberately retains its KEEP rows unless stated otherwise.

## Batches

The batches are file-disjoint. **B precedes A** because `command-center` imports `@ptah-extension/tribunal-panel/phase` and `/discovery` in production and tests; deleting the library first would break compilation. Each batch should compile on its own where the current code permits. Run its scoped check after that batch during implementation; these commands are planned, not run in this planning pass. `npm run verify` invokes Nx with `--parallel=1` (`scripts/verify.mjs:84-88`).

### B — remove the Command Center Tribunal flow while the library still exists

**DELETE** these complete files under `libs/frontend/command-center/src/lib/`:

- `components/command-center-roster.provider.ts`, `components/command-center-roster.provider.spec.ts`
- `components/command-center-tribunal-intent.ts`, `components/command-center-tribunal-intent.spec.ts`
- `components/command-center-tribunal.transport.ts`, `components/command-center-tribunal.transport.spec.ts`
- `integration/tribunal-confirm-gate.spec.ts`
- `model/tribunal-roster-proposal.ts`, `model/tribunal-roster-proposal.spec.ts`, `model/tribunal-roster-proposal.contract.spec.ts`
- `model/tribunal-run-coordinator.ts`, `model/tribunal-run-coordinator.spec.ts`

**EDIT** these existing Command Center files, removing only Tribunal-specific injection/imports, intent detection, proposal state, confirmation/decline/timeout card, persisted run projection, node kinds, scene/sprite/phase geometry and status narration; preserve generic agents, session controls, questions, pending input, voice and live lane monitoring:

- `libs/frontend/command-center/src/lib/components/command-center-page.component.ts`, `.spec.ts`; `command-center-page.controller.ts`, `.spec.ts`; `command-center-projection.source.ts`, `.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-node-detail.component.ts`, `command-overlay.component.ts`, `command-pending-input.component.ts`, `.spec.ts`, `command-session-controls.component.ts`, `.spec.ts`
- `libs/frontend/command-center/src/lib/integration/delegation-and-status.spec.ts`, `integration-harness.testing.ts`
- `libs/frontend/command-center/src/lib/model/command-center.store.ts`, `work-projection.ts`, `work-projection.spec.ts`
- `libs/frontend/command-center/src/lib/scene/command-scene-status.ts`, `command-scene.component.ts`, `scene-layout.ts`, `scene-layout.spec.ts`, `sprite-cache.ts`
- `libs/frontend/command-center/src/lib/voice/status-narrator.ts`, `status-narrator.spec.ts`
- `libs/frontend/chat-state/src/lib/command-center-persona.ts`, `command-center-persona.spec.ts`, `libs/frontend/chat-state/src/index.ts`: remove `COMMAND_CENTER_TRIBUNAL_REQUEST`, `TRIBUNAL_ROSTER_PROPOSAL` and their exports/tests; retain generic Command Center persona and `CommandCenterRunManifest` exports.
- `libs/frontend/chat-routing/src/lib/stream-router.service.ts`, `stream-router.setup-surfaces.spec.ts`: remove only stale conductor ownership examples; retain shared routing behavior. If no runtime branch exists, this is a comment/test fixture update only.

Before deleting the roster provider, move any generic pending-question or request handling it currently owns into the surviving controller/store so ordinary Command Center questions still work. Retain `command-center-records.ts` and the tab manager unchanged; old manifests remain parseable/stored, although the special run card is retired.

**Nx projects:** `@ptah-extension/command-center`, `@ptah-extension/chat-state`, `@ptah-extension/chat-routing`.

**Scoped check:** `npm run verify -- -t test,typecheck,lint -p @ptah-extension/command-center,@ptah-extension/chat-state,@ptah-extension/chat-routing`

### A — remove the route, page library and shell surfaces

**DELETE** the entire `libs/frontend/tribunal-panel/` Nx project. Exact project-root files: `eslint.config.mjs`, `jest.config.ts`, `package.json`, `project.json`, `tsconfig.json`, `tsconfig.lib.json`, `tsconfig.spec.json`. Exact `src/` files: `discovery.ts`, `discovery.spec.ts`, `index.ts`, `phase.ts`, `phase.spec.ts`, `test-gridstack-stub.ts`, `test-setup.ts`; `lib/components/{conductor-tile.component.ts,conductor-tile.component.spec.ts,crucible-verdict-panel.component.ts,crucible-verdict-panel.component.spec.ts,relay-phase-rail.component.ts,relay-phase-rail.component.spec.ts,tribunal-empty-state.component.ts,vendor-card.component.ts,vendor-card.component.spec.ts}`; `lib/services/{judge-report.parser.ts,judge-report.parser.spec.ts,spec-documents.ts,tribunal-discovery.service.ts,tribunal-discovery.service.spec.ts,tribunal-estimate.ts,tribunal-estimate.spec.ts,tribunal-phase-derivation.ts,tribunal-phase-derivation.spec.ts,tribunal-progress.service.ts,tribunal-progress.service.spec.ts,tribunal-roster-rules.ts,tribunal-roster-rules.spec.ts,tribunal-run.service.ts,tribunal-run.service.spec.ts,tribunal-run-framing.ts,tribunal-run-framing.spec.ts,tribunal-state.service.ts,tribunal-state.service.spec.ts}`; `lib/{tribunal-page.component.ts,tribunal-page.component.spec.ts,tribunal-tile-host.component.ts}`; `lib/types/{tribunal-ui.types.ts,tribunal-ui.types.spec.ts}`; `lib/wizard/{step-crucible-rubric.component.ts,step-crucible-rubric.component.spec.ts,step-panel-preview.component.ts,step-panel-preview.component.spec.ts,step-pick-move.component.ts,step-pick-move.component.spec.ts,step-role-roster.component.ts,step-run.component.ts,tribunal-wizard.component.ts,tribunal-wizard.component.spec.ts}`. The inventory includes the page files containing “tribunal”; this explicit list also includes configs and test setup without that word.

**EDIT** workspace wiring: `tsconfig.base.json` (all three `tribunal-panel` aliases), `nx.json` (both project path inputs), `.commitlintrc.json` (scope), `.github/ci/test-weights.json` (weight), `tools/degradation-audit/baseline.json` (retired project row). Inspect `eslint.config.mjs`, `jest.config.ts`, `package.json`, `package-lock.json`, `.gitignore` and `.nxignore` for package/project references; current targeted search found none to remove from the first four and `.tribunal/` in the last two must stay. No lockfile regeneration is indicated by deleting a workspace project with no package dependency change.

**EDIT** route/surface/host wiring and corresponding specs:

- `apps/ptah-extension-webview/src/app/app.routes.ts`, `webview-routing.spec.ts`: delete the lazy `/tribunal` page route/provider/import and its route assertions, including `JEST_UNRESOLVABLE_SURFACES` exception. The existing `**` route redirects stale `/tribunal` URLs to chat.
- `libs/shared/src/lib/types/webview-surface.types.ts`, `.spec.ts`: delete `'tribunal'` from surface/view union and registered route IDs, then update type assertions.
- `apps/ptah-extension-vscode/src/services/webview-html-generator.ts`, `webview-html-generator.initial-view.spec.ts`: remove Tribunal from the initial-view surface list/expectations; unsupported initial values must fall back to chat.
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.html`, `app-shell.component.ts`, `electron-shell.component.ts`, `electron-shell.apps-tab.spec.ts`, `electron-shell.config-gate.spec.ts`: remove VS Code navigation button, Electron tab and `openTribunal()` methods; update tab order/deferred-view comments.
- `libs/frontend/chat/src/lib/services/workspace-coordinator.service.spec.ts`: use a surviving standalone view in workspace-switch coverage.
- `libs/frontend/harness-builder/src/lib/components/setup-hub.component.ts`: remove the page launch card/action; if the hub retains a Tribunal callout, point it to main chat and the skill prompt, not a view ID.
- `libs/frontend/core/src/lib/services/app-state.service.ts`, `app-state.service.spec.ts`, `libs/frontend/core/src/lib/tokens/lazy-view-components.token.ts`: replace retired Tribunal examples/comments and test fixtures; keep generic state. Ensure a raw initial view or remembered `currentView: 'tribunal'` normalizes to chat before navigation if any persisted source can bypass `normalizeInitialView`; add a focused regression in the existing spec if needed.
- `libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.ts`, `apps-workspace-slice.ts`: replace comments citing the deleted Tribunal state file; no behavior change.
- `libs/shared/src/lib/providers/entries/claude-cli-provider-entry.ts`: replace obsolete panel example in comment.

**Nx projects:** `ptah-extension-webview`, `ptah-extension-vscode`, `@ptah-extension/shared`, `@ptah-extension/chat`, `@ptah-extension/core`, `@ptah-extension/harness-builder`, `@ptah-extension/mcp-apps-page`; `@ptah-extension/tribunal-panel` disappears and must not be passed to Nx after deletion.

**Scoped check:** `npm run verify -- -t test,typecheck,lint -p ptah-extension-webview,ptah-extension-vscode,@ptah-extension/shared,@ptah-extension/chat,@ptah-extension/core,@ptah-extension/harness-builder,@ptah-extension/mcp-apps-page`

### C — retire the page-only RPC and dedicated harness preset

**DELETE** `apps/ptah-extension-vscode/assets/harnesses/tribunal-conductor.json`.

**EDIT** `libs/backend/rpc-handlers/src/lib/harness/config/builtin-presets.ts` to remove only the `tribunal-conductor` preset; keep generic presets and the Tribunal skill installer. **EDIT** `libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts` to remove the `tasks:getRoundJudge` registration, method and imports; edit `tasks-rpc.handlers.spec.ts` to remove that RPC's cases and registry fixture, retaining other task RPC cases. **EDIT** `libs/shared/src/lib/types/rpc.types.ts` (method and allowlist map), `libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts` (method), and `libs/shared/src/lib/types/rpc/rpc-tasks.types.ts` (RPC-only params/result). Keep `libs/shared/src/lib/types/task-spec.contract.ts` and `roundJudgeFile()`; the skill's Crucible artifacts still need that naming contract. **EDIT** only the RPC-specific documentation comment in `libs/backend/task-specs/src/lib/task-index.service.ts`; keep its artifact reader unless a separate usage audit proves it dead.

Inspect `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`, `src/di/expected-resolvable.ts`, `src/di/surface-composition.spec.ts` for explicit method/preset expectations. Targeted string search found no Tribunal/RoundJudge reference in these guards, so no edit is planned unless their compilation reveals a generated-set expectation. Preserve the rest of the RPC surface.

**Nx projects:** `@ptah-extension/rpc-handlers`, `@ptah-extension/shared`, `@ptah-extension/task-specs`, `ptah-extension-vscode`.

**Scoped check:** `npm run verify -- -t test,typecheck,lint -p @ptah-extension/rpc-handlers,@ptah-extension/shared,@ptah-extension/task-specs,ptah-extension-vscode`

### D — make the retained skill the sole Tribunal workflow

**EDIT as identical pairs** under both `.claude/skills/` and `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/`:

- `tribunal/SKILL.md`: replace description phrase “Tribunal UI launches”; explain main-chat invocation, explicit plain-text pins, duplicate lanes and the confirm-before-spawn gate. Keep Council, Forge, Race, Crucible and Relay entry/delegation, `ptah_agent_*` mechanics and the cited-result rules.
- `tribunal/references/vendor-panel.md`: rewrite §0 from UI-generated `[tribunal:<laneId>]`/`spawnArgs` syntax to user-supplied plain-text vendor, model and role pins. Resolve each requested lane via `ptah_agent_list` without deduplicating, preserve order and role, surface unavailable pins instead of silently substituting, present resolved panel plus expected paid calls/rounds, and require user confirmation before any `ptah_agent_spawn`. Keep deterministic discovery for unpinned panels and anonymized review/synthesis.
- `tribunal/references/relay.md`: replace UI framing table with plain-text phase-to-lane pins; retain orchestration's lane-assignment, distinct reviewer and approval gates.
- `orchestration/references/task-tracking.md`: remove “Spec folder … already created by Tribunal UI” assumption; accept a user-provided existing folder from chat, otherwise allocate according to orchestration.

Review the mirrored `agent-lanes/SKILL.md` and `orchestration/references/lane-assignment.md` references; they currently describe live lane mechanics/delegation, so **KEEP** unless a remaining UI-only statement is found. Do not remove any `ptah_agent_*` tool or generic skill install path.

**ADD** `libs/backend/vscode-lm-tools/src/lib/code-execution/tribunal-skill-mirror.spec.ts`: compare exact bytes for the four edited skill/reference pairs, so future edits cannot drift. Existing `skill-description-shape.spec.ts`, `vendor-roster-drift.spec.ts`, `lane-rule-single-home.spec.ts` and `libs/backend/harness-sync/src/lib/targets/skill-sibling-links.spec.ts` check shipped skill shape, vendor policy, rule ownership and sibling links; update their expectations only if the new wording actually breaks an assertion. They do not currently establish full mirror byte parity.

**Nx projects:** `ptah-extension-vscode` (shipped assets), `@ptah-extension/vscode-lm-tools`, `@ptah-extension/harness-sync` (the latter is a regression check for skill links).

**Scoped check:** `npm run verify -- -t test,typecheck,lint -p ptah-extension-vscode,@ptah-extension/vscode-lm-tools,@ptah-extension/harness-sync`

### E — rewrite the public story and remove obsolete tours

**DELETE** `apps/ptah-electron-e2e/src/showcase/tribunal-tour.scene.ts`, `src/showcase/scripts/tribunal-tour.json`, and `src/specs/tribunal/tribunal.spec.ts`.

**EDIT** `apps/ptah-electron-e2e/src/showcase/dashboard-tour.scene.ts`, `src/showcase/scripts/dashboard-tour.json`, and `src/support/ui-driver.ts` to remove the Tribunal tab beat, selector and page surface. Keep a skill-in-chat voiceover mention only if it matches the actual footage. Check any scene discovery by filename so deletion does not leave a stale reference.

**EDIT** the six surviving mode/overview guides under `apps/ptah-docs/src/content/docs/tribunal/`: `index.mdx`, `council.md`, `forge.md`, `race.md`, `crucible.md`, `relay.md`. Teach main-chat skill invocation, plain-text pins, confirmation and `ptah_agent_*` lane outcomes; remove tab, wizard, harness picker, tiles and page close instructions. Relay remains a Tribunal skill entry that delegates phase execution to orchestration. **EDIT** docs linking pages `apps/ptah-docs/src/content/docs/agents/agent-orchestration.md`, `agents/index.mdx`, `getting-started/first-launch.md`, `setup/index.md` to remove obsolete navigation. `apps/ptah-docs/astro.config.mjs` should keep the `/tribunal/` sidebar URLs, but relabel the section/overview as the skill if its current label implies a page. Keep `content-manifest.json` Tribunal and lane/orchestration skill entries; regenerate only if the manifest generator requires a content change. Edit `README.md` Setup Hub screenshot caption/description and Tribunal copy so they do not promise a now-removed entry point; keep the docs link.

**EDIT** `apps/ptah-video-studio/FOLLOW-UP.md` (retire `tribunal-tour` recapture list), `apps/ptah-video-studio/docs/feature-knowledge-base.md` (skill-only framing and five moves), `libs/web/landing/src/lib/console/council-demo.component.ts` and `src/lib/sections/hero/hero-device-showcase.component.ts` (label staged Council illustration as a skill/chat demo), `tools/hyperframes/kits/ptah-ui/SPEC.md` and `src/app-window.html` (remove mock Tribunal navbar tab). Keep archival video narration/beat files that are not a current entry point. Keep historical benchmark fixtures/logs and generic docs links from inventory unless their wording explicitly promises the page.

**Nx projects:** `ptah-electron-e2e`, `ptah-docs`, `ptah-video-studio`, `web-landing`; `README.md` and `tools/hyperframes/kits/ptah-ui/*` have no dedicated Nx target in the inspected project set.

**Scoped check:** `npm run verify -- -t test,typecheck,lint -p ptah-electron-e2e,ptah-docs,ptah-video-studio,web-landing` (Nx runs targets present for each project; docs has no `test`, `typecheck` or `lint` target, and e2e has `typecheck` only). Do not run Playwright merely to validate this docs/tour batch.

## Mirror rule

Treat `.claude/skills/<relative path>` as the editable source and copy each changed file byte-for-byte to `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/<relative path>` in the same batch. Do this for `tribunal/SKILL.md`, `tribunal/references/vendor-panel.md`, `tribunal/references/relay.md`, and `orchestration/references/task-tracking.md`. The five spot-checked current pairs (those three Tribunal files, task tracking and `agent-lanes/SKILL.md`) have equal SHA-256 hashes. No existing sync script or full byte-equality spec was found: `skill-sibling-links.spec.ts:188-193` checks shipped Tribunal/orchestration sibling declarations, `lane-rule-single-home.spec.ts:16-19,64` scans shipped skill policy, and `skill-description-shape.spec.ts`/`vendor-roster-drift.spec.ts` check shipped semantics. The new mirror spec in D makes byte parity a scoped regression gate; a read-only hash comparison is a useful review check too.

## Verification

No build, serve, e2e, test, install or workspace-wide check is part of this **plan-only** pass. During implementation, run the five scoped `npm run verify -- -t test,typecheck,lint -p ...` commands above, one heavy run at a time. Focus B on generic Command Center questions/voice and historical manifest parsing, A on route fallback and shell tab order, C on RPC registry contract, D on skill mirror/policy, and E on e2e TypeScript references and docs review. Run only changed-project targets; Nx skips missing targets where defined.

After all batches, typecheck every required host with `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-tui,ptah-extension-webview,ptah-cli` (and keep `--parallel=1`). This final host check is mandatory even when a host had no direct file edit. Review the resulting Nx project graph for absence of `@ptah-extension/tribunal-panel` and search production code for `@ptah-extension/tribunal-panel`, `/tribunal` navigation and `tasks:getRoundJudge`; retained skill docs and historical fixtures may still contain the word “tribunal”. The plan cannot establish actual compilation or test success because execution was explicitly prohibited. `ptah-docs` has no requested verify target; inspect links/sidebar statically, and use its own check only if later authorized. Playwright, builds and video rendering are outside the requested check set.

## Risks

| Risk | Mitigation |
| --- | --- |
| Removing the lazy route leaves old chunk assertions or a stored `/tribunal` URL | Remove `JEST_UNRESOLVABLE_SURFACES`/route expectations; the existing `**` route redirects to `DEFAULT_SURFACE_ID`. Exercise raw initial-view and remembered-view fallback to chat in existing app-state/routing specs. |
| `currentView: 'tribunal'` persists in older host/session data | `normalizeInitialView` already validates route IDs; inspect all restore paths, normalize unknown IDs before `requestSurface`, retain generic workspace behavior. |
| Command Center roster provider also owns generic pending questions | Extract/retain generic question handling before deleting it; test non-Tribunal question, voice and agent cards. |
| Old `CommandCenterRunManifest` records lose storage compatibility | Keep schema, exported storage type and tab-manager cleanup untouched; remove only new proposal and special projection. Verify old-record parse/cleanup tests. |
| Deleting the Nx project leaves stale graph/cache or path aliases | Remove `nx.json`, TS path, commit scope, CI weight and degradation baseline entries; if graph results appear stale, perform a fresh scoped Nx invocation with `--skip-nx-cache` rather than trusting old output. |
| RPC removal affects unsearched external clients | Repository search found no non-page production caller; record API removal in release notes if external clients exist. Preserve artifact reader and other task RPCs. |
| Scene discovery or e2e driver still references deleted selectors | Remove scene/script/spec and driver enum/selector together; rely on e2e project's typecheck plus static reference search, with no Playwright run requested. |
| Skill copies or roster semantics diverge | Byte-equality spec plus shipped skill policy specs; confirm duplicate pins, unavailable models, call count and permission gate in skill wording. |

## Decisions

| Decision | Options | Evidence | Reversible? |
| --- | --- | --- | --- |
| Sole invocation is main-chat `tribunal` skill | Keep page/Command Center launch or retire both | Binding `context.md` decisions 1, 4; inventory route, Command Center and skill map | Yes, by rebuilding UI; deleted form controls are not retained. |
| Remove Command Center before page library | Delete library first or remove dependent imports first | `work-projection.ts`, `command-center-projection.source.ts`, transport, intent and proposal import `/phase` or `/discovery` | Yes; sequencing only. |
| Remove page-only RPC but preserve artifacts | Keep RPC or delete `tasks:getRoundJudge` surface | `context.md` decision 3; inventory RPC table; only page production caller | Yes for RPC; artifact contract stays. |
| Keep old manifest storage, retire new-run grouping | Delete storage, keep grouping, or keep storage without new grouping | `context.md` decision 3; inventory writer/projection table and approved removal 6 | Partly; old records remain, special cards can be reintroduced later. |
| Delete conductor preset, keep generic harness and skill install | Keep alternate preset or delete it | `context.md` decision 2; `builtin-presets.ts` and harness asset | Yes. |
| Plain-text pins, duplicates and pre-spawn confirmation | UI syntax only, discovered panel only, or explicit chat pins | `context.md` decision 4; `vendor-panel.md` §0 currently requires UI-generated lines | Yes; skill wording can change. |
| Preserve `/tribunal/` docs as skill guide | Delete docs, leave obsolete UI guide, or rewrite | Inventory File actions and docs sidebar | Yes. |
| Leave four overlapping chat files untouched | Edit now or defer to other branch | `context.md` Overlap with `fix/lane-chat-order` | Yes; no required retirement change there. |

## Clarifications Needed

None. The user approved all removal choices and resolved the roster, preset, RPC and storage questions in `context.md`.
