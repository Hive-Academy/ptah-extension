# Code Logic Review — `TASK_2026_877_85fa`

## Summary

| Metric | Value |
| --- | --- |
| Score | 5/10 |
| Assessment | REVISE |
| Blocking / Serious / Moderate / Minor | 0 / 1 / 2 / 1 |

The sampled feature claims are backed by code. Five planned v2 screenshots are absent, and one README image target is missing. This scores above 3–4 because the central feature claims checked out, and below 7–8 because the requested screenshot set is incomplete.

## Findings

1. **Serious — Five of six planned v2 screenshots are absent.** `apps/ptah-electron-e2e/src/docs-screenshots/v2-surfaces.shot.ts:11-18,51-106` skips Voice, session rail, Apps, attention bell, and Display because mock data is missing. `apps/ptah-docs/SCREENSHOTS.md:17-23` labels all six as GitHub README shots, but only `v2-thoth-memory.png` exists, and `README.md:139` embeds only that one. Readers cannot inspect five advertised surfaces. Complete fixtures, captures, and README embeds or explicitly reduce task scope.
2. **Moderate — Broken README logo URL.** `README.md:3` points to `apps/ptah-landing-page/public/assets/icons/ptah-icon.png`, which does not exist in this worktree. Use an existing asset. This predated the diff, but the requested link audit covers the entire README.
3. **Moderate — New shot spec diverges from the docs capture fixture.** `v2-surfaces.shot.ts:1` imports `../support/fixtures`, which installs mocked RPCs (`apps/ptah-electron-e2e/src/support/fixtures.ts:36-38`). Existing `sessions.shot.ts:1` imports `./_harness/docs-fixtures`; that harness explains mocked RPCs produce empty/error docs screens (`apps/ptah-electron-e2e/src/docs-screenshots/_harness/docs-fixtures.ts:14-29`). Memory is seeded in the new spec; the five skipped surfaces are not. Use the docs fixture where real state is needed or seed each mocked surface. The isolated new file does not change other specs.
4. **Minor — Two URLs are outside the requested domain rule.** The image badge at `README.md:11` uses `img.shields.io` and Issues at `README.md:262` uses `github.com`. They appear intentional and are not proven broken, but neither is a local file nor a `ptah.live`/`docs.ptah.live` URL. These are the only out-of-policy links among 35 unique HTTP URLs checked. All local Markdown targets exist.

## Five logic questions

1. **Silent failure:** skipped screenshot cases yield no PNG despite the six-shot checklist (`v2-surfaces.shot.ts:11-18,51-106`; `SCREENSHOTS.md:17-23`).
2. **Unexpected user action:** opening the README shows a missing logo (`README.md:3`); looking for the new Voice, Apps, rail, bell, or Display screenshots finds none (`README.md:48-58,119-133`).
3. **Wrong input data:** unseeded mock RPCs generate empty/error capture states, as the docs fixture warns (`docs-fixtures.ts:14-29`); Memory alone has synthetic records (`v2-surfaces.shot.ts:20-45`).
4. **Dependency failure:** the screenshot report records Playwright worker-spawn `EPERM`, so those tests never reached a body (`.ptah/specs/TASK_2026_877_85fa/screenshots-report.md:14-19`).
5. **Implicit gap:** the supplied Memory PNG still shows status “Checking…” and Skills “Unavailable”; a published capture should present a settled surface.

## Claims verified

| README claim | Source checked | Result |
| --- | --- | --- |
| Eight task types, three depths (`README.md:76`) | `libs/shared/src/lib/types/task-spec.types.ts:23-32`; `libs/backend/lane-routing/src/lib/contracts/route-decide-args.schema.ts:17,48` | Supported |
| Three-second decision timeout (`README.md:77`) | `libs/backend/lane-routing/src/lib/routing-constants.ts:116`; `decision-model/decision-caller.ts:83` | Supported |
| 90-day outcomes (`README.md:78`) | `libs/backend/lane-outcomes/src/lib/store/key-value-lane-outcome.store.ts:145` | Supported |
| Same-family review exclusion (`README.md:79`) | `libs/backend/lane-routing/src/lib/ranking/hard-constraints.ts:52-55,131-162` | Supported |
| Scope check and Routing reminder (`README.md:80`) | `libs/backend/rpc-handlers/src/lib/chat/host-routing/host-routing.coordinator.ts:5-8`; `routing-reminder.format.ts:40` | Supported |
| 20 rail tiles, 9 running (`README.md:52`) | `libs/frontend/canvas/src/lib/canvas-layout-intent.ts:11`; `canvas-running-cap.ts:6-7` | Supported |
| Resume above 150,000 tokens or 10 minutes refused (`README.md:108`) | `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-resume-gate.ts:46-49,253-263` | Supported |
| Subagent warning at 85% (`README.md:111`) | `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.ts:185` | Supported |
| CLI lane names (`README.md:95,182`) | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/index.ts:22-28`, Claude/Codex runners | Supported for named adapters |
| Named Claude personal-login verification (`README.md:98`) | `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts:622-680,809-825` | Supported |
| Voice needs STT and TTS (`README.md:53`) | `libs/frontend/command-center/src/lib/components/command-center-page.component.ts:159-167` | Supported |
| Apps uses surface update/catalog (`README.md:123`) | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/surface-tools.ts:39`; `libs/frontend/mcp-apps-page/src/lib/apps-system-prompt.ts:9,15-20` | Supported |
| Cron catch-up window and policies (`README.md:161`) | `libs/backend/cron-scheduler/src/lib/types.ts:30-35,120-121`; `cron-scheduler.ts:13-25,129` | Supported |
| Discord session/workspace commands (`README.md:158`) | `libs/backend/messaging-gateway/src/lib/commands/gateway-command.service.ts:3,174,199,266,316` | Supported |
| Electron 44, Angular 22, Nx 24, TS 6.0.3, Node 24 (`README.md:229`) | `package.json:4,73,183,199,208` | Supported |

## Other checks

- Forbidden claims absent from `README.md`: “only Ptah”/exclusivity, 16-message carry-over, 500,000-token cap, “System-1”, drag-and-resize canvas grid, Angular 21.
- Static Markdown inspection: Mermaid flowchart and fence at `README.md:83-91`, tables at `README.md:27-44`, and `<details>` at `README.md:179-186` are structurally valid. GitHub rendering was not run.
- Opened `v2-thoth-memory.png`: the three synthetic entries match `v2-surfaces.shot.ts:27-31`; no visible personal name, email, token, or key. `git status --short` shows no changed existing spec.
- Scoped `ptah_get_diagnostics` for the shot spec: zero errors and warnings. No build, serve, test, or e2e command was run, as requested. Skill-loading tools were unavailable in this lane.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Treat six-shot checklist as in scope | Require all six; reduce scope | `context.md:15-19`, `SCREENSHOTS.md:17-23` | Yes |
| Distinguish third-party URLs from broken targets | Treat as broken; allow known services | `README.md:11,262` | Yes |

## Verdict

**REVISE.** Fifteen sampled feature claims are supported, but the screenshot requirement is incomplete and the README logo URL is broken. Confidence is high for local files and static code, medium for rendered captures because e2e execution was prohibited.
