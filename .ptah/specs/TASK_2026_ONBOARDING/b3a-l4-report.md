# B3a L4 report — match % 0–100 and A1/A2 analyze captures

Lane: frontend-developer (continuing L2). Worktree: `/home/amun/ptah-extension/.claude-worktrees/onboarding-module`. No git writes. No browser. No build/serve/dev/e2e/package.

Skill: `angular-frontend-patterns` loaded from `.claude/skills/angular-frontend-patterns/SKILL.md` before the match-% edit. Ptah: `ptah__ptah_search_files` for the ready suite; native `grep`/`read_file` for RPC and testids after the index was enough. `impeccable` / `ui-ux-designer` were not in this CLI catalogue. Browser captures were not run (lane rule).

## Files changed

| File | Change |
| --- | --- |
| `libs/frontend/onboarding/src/lib/analyze/agent-recommendation-list.component.ts` | `matchPercent` treats `relevanceScore` as 0–100 |
| `libs/frontend/onboarding/src/lib/analyze/agent-recommendation-list.component.spec.ts` | 0/50/92/100 shown; -1/100.5/NaN/Infinity hidden; fixtures use 92 |
| `libs/frontend/webview-e2e-harness/src/lib/scenarios/onboarding/onboarding-ready-capture.ts` | `outputDir` + `busyExempt`; `ONBOARDING_ANALYZE_CAPTURE_DIR` |
| `libs/frontend/webview-e2e-harness/src/lib/scenarios/onboarding/onboarding-analyze.fixtures.ts` | **new** wizard RPC boot + scan-progress injects |
| `libs/frontend/webview-e2e-harness/src/lib/scenarios/onboarding/onboarding-analyze-visual.e2e.spec.ts` | **new** A1/A2 capture spec |

Not edited (other lane): `choose-agents.page.ts`, `onboarding.routes.ts`, `analysis-step.store.ts`, `analyze-workspace.page.ts`, `phase-list.component.ts`.

Registration: Playwright `testMatch: ['**/*.e2e.spec.ts']` already picks up the spec. No verify.mjs task list names the ready suite; the spec comment uses grep tag `onboarding-analyze-visual` the same way ready uses `onboarding-ready-visual`.

## Match % (coordinator ## B3a)

`matchPercent` now: hide when non-finite or outside 0..100; else `Math.round(score)`. Doc comment names the backend 0–100 range. Unit fixtures use `92` / `40`, not `0.92` / `0.4`.

## Fixture states

Boot: Electron host, FLAG_DONE + Claude ready, Home via `switchView`, then in-app click (never `page.url()`).

**A1** (`[data-testid="analyze-workspace"]`):

| State | RPC / inject | Asserted text / ids |
| --- | --- | --- |
| saved list | `wizard:list-analyses` → NestJS API row | Saved analyses, Use, Hide from list |
| running Phase 2 of 4 | `wizard:deep-analyze` NEVER_ANSWERED; inject `setup-wizard:scan-progress` (2/4) + four analysis-stream events | `phase-header` “Phase 2 of 4”; `ol[aria-label="Analysis phases"] li[data-status="running"]`; `details-log-counts` “4 events” |
| interrupted | `wizard:get-resumable-run` paused analysis | Interrupted analysis; Continue previous run; Start fresh |
| failed | `wizard:deep-analyze` → `rpcError` | Analysis failed |
| completed | list + `wizard:load-analysis` completed; click Use | Analysis complete; Manual adjust |

**A2** (`[data-testid="choose-agents"]`), catalog path via `onboarding-link-agents-only` (`source=catalog`):

| State | Asserted |
| --- | --- |
| agent-only banner | `agent-only-banner` copy |
| 92% row | `agent-recommendation-match` “92% match” |
| selection count | `agent-recommendation-count` “1 selected” (auto-select recommended) |
| owner conflict | Preview → confirm; `wizard:submit-selection` `{ reason: 'blocked' }`; `choose-agents-owner-banner` “Another run is active.” |

## Capture list

Output: `.ptah/specs/TASK_2026_ONBOARDING/screenshots/analyze/<view>-<theme>-<w>x<h>.png` + sibling `.axe.json`.

Themes: `ptah-glass`, `ptah-glass-light`, `anubis`, `anubis-light`. Widths: WIDE 1280×800, NARROW 464×800.

Views (each × 4 themes × 2 widths = 72 captures):

- `analyze-saved-list`, `analyze-running-phase-2`, `analyze-interrupted`, `analyze-failed`, `analyze-completed`
- `agents-catalog-banner`, `agents-92-match`, `agents-selection-count`, `agents-owner-conflict`
- same nine with `narrow-` prefix

Coordinator run: `npx nx run @ptah-extension/webview-e2e-harness:e2e --skip-nx-cache -- onboarding-analyze-visual` (after a webview build; this lane did not run e2e).

## Assumed / present test ids

Present (read, not edited): `analyze-workspace`, `phase-header`, `details-log`, `details-log-counts`, `choose-agents`, `agent-only-banner`, `context-source`, `choose-agents-list`, `choose-agents-toolbar`, `choose-agents-owner-banner`, `choose-agents-preview-trigger`, `agent-recommendation-match`, `agent-recommendation-count`, `onboarding-path-link-analyze`, `onboarding-link-agents-only`, `preview-confirm`.

Phase list has no testids — used `ol[aria-label="Analysis phases"]` and `li[data-status]`. Saved list has no `saved-analysis-list` / `saved-analysis-item-*` — used visible “Saved analyses” / Use / Hide.

Assumed for owner-conflict runtime (not in A2 page, used by preview/submit): `wizard:preview-generation` returns `{ agents: [{ agentId, files: [] }], previewToken }`; `wizard:get-generation-run-state` `{ run: null }` so init stays idle; launcher `open({ focus: false })` creates a generation tab so `binding()` is set. If that tab is missing at e2e time, recovery renders inside `choose-agents` and the owner banner capture will fail.

## Decisions

- Match % follows decisions.md ## B3a (backend 0–100), not design-spec A2 `score*100`.
- Capture helper parameterized (`outputDir`, `busyExempt`) instead of a second copy; ready default path unchanged.
- Catalog path used for all A2 captures so they do not depend on a completed A1 analysis query.
- Owner conflict is produced after Preview confirm, not on load (`GenerationWorkflowStore.refresh` does not set `rejection`).
- NARROW 464px on every view so the content area is 400px (same B1c decision as ready).

## Verification tail

```
 NX   Successfully ran targets lint, test, typecheck for 2 projects

- @ptah-extension/onboarding
- @ptah-extension/webview-e2e-harness

✔  nx run @ptah-extension/onboarding:typecheck
✔  nx run @ptah-extension/onboarding:test
✔  nx run @ptah-extension/onboarding:lint
✔  nx run @ptah-extension/webview-e2e-harness:typecheck
✔  nx run @ptah-extension/webview-e2e-harness:lint

  Run duration:      4m 9s
[verify 2026-10-30T11:13:45.894Z] lock released after 260.6s, exit code 0
```

Harness has no Jest `test` target in that run. Other-lane files did not fail. E2e not run.

## Revision 1

Review finding 5 (template) and the 16/72 capture strict-mode failure. Codex-owned files were not edited. E2e was not re-run.

### matchedCriteria guard

`row.agent.matchedCriteria.length` threw when the host omitted the field.

- `libs/frontend/onboarding/src/lib/analyze/agent-recommendation-list.component.ts:41` — `criteriaOf` treats a missing or non-array value as `[]` (`Array.isArray`, then string items only).
- Same file `:192` — each row view-model stores `criteria: criteriaOf(agent)`.
- Same file `:148` and `:153` — the chip block uses `row.criteria`, not `row.agent.matchedCriteria.length`.
- `libs/frontend/onboarding/src/lib/analyze/agent-recommendation-list.component.spec.ts:148` — a row cast without `matchedCriteria` renders the name and no `[data-testid="agent-recommendation-criteria"]`.

`selectRecommended()` still lives in the Codex-owned store; this lane did not change it.

### Capture locator

`onboarding-analyze-visual.e2e.spec.ts:126` matched both the 40% and 92% badges, so every `agents-92-match` and `agents-owner-conflict` capture failed in strict mode.

- `libs/frontend/webview-e2e-harness/src/lib/scenarios/onboarding/onboarding-analyze-visual.e2e.spec.ts:127-130` — `agent-recommendation-match` is filtered with `{ hasText: '92% match' }` and asserted `toHaveCount(1)`.

Other locators in that spec: `agent-recommendation-match` is the only per-row testid the spec queried unfiltered. `agent-only-banner`, `agent-recommendation-count`, `choose-agents-preview-trigger`, `choose-agents-owner-banner` each occur once on `choose-agents.page.ts`. `preview-confirm` is the single `AgentPreviewDialog` on that page. The count locator now also has `toHaveCount(1)` (`:131`). A1 `analyze-*` captures already passed; those role and phase locators were left as they are.

### Verification tail

```
 NX   Successfully ran targets lint, test, typecheck for 2 projects

- @ptah-extension/onboarding
- @ptah-extension/webview-e2e-harness

✔  nx run @ptah-extension/onboarding:typecheck
✔  nx run @ptah-extension/onboarding:test
✔  nx run @ptah-extension/onboarding:lint
✔  nx run @ptah-extension/webview-e2e-harness:typecheck
✔  nx run @ptah-extension/webview-e2e-harness:lint

  Run duration:      6m 0s
[verify 2026-10-30T11:40:58.063Z] lock released after 373.4s, exit code 0
```

No Codex-owned file failed this run. E2e not re-run.
