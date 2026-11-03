# B3a L2 report — onboarding step-link table + A2 recommendation list

## Frontend implementation — `TASK_2026_ONBOARDING`, batch B3a, lane L2

**Tasks completed**: cross-owner `onboardingStepLink` table; presentational `AgentRecommendationListComponent`.

**Files**:

- MODIFIED `/home/amun/ptah-extension/.claude-worktrees/onboarding-module/libs/frontend/onboarding/src/lib/shell/onboarding-step-link.ts` — A2 cross-owner query rules
- MODIFIED `/home/amun/ptah-extension/.claude-worktrees/onboarding-module/libs/frontend/onboarding/src/lib/shell/onboarding-step-link.spec.ts` — agent→guidance / guidance→done / A4 back tests
- CREATED `/home/amun/ptah-extension/.claude-worktrees/onboarding-module/libs/frontend/onboarding/src/lib/analyze/agent-recommendation-list.component.ts` — grouped A2 list
- CREATED `/home/amun/ptah-extension/.claude-worktrees/onboarding-module/libs/frontend/onboarding/src/lib/analyze/agent-recommendation-list.component.spec.ts` — grouping, match %, chips, toolbar, disabled
- CREATED `/home/amun/ptah-extension/.claude-worktrees/onboarding-module/.ptah/specs/TASK_2026_ONBOARDING/b3a-l2-report.md` — this report

**Stack observed**: Angular standalone + signals + OnPush (`item-status-card.component.ts`); DaisyUI/Tailwind tokens and `data-glass-surface` (`run-status-chip.component.ts`); Lucide `[img]` registration (`item-status-card.component.ts`). Skill `angular-frontend-patterns` loaded from `.claude/skills/angular-frontend-patterns/SKILL.md`.

**Design fidelity**: design-spec A2 (grouped list, 0..1 match %, chips, toolbar) and §13 (glass `tile`, decorative `bot` icon). Row Preview button omitted — task outputs are toggle/selectRecommended/clear only; preview lives on `ChooseAgentsPage` (other lane).

**States covered**: empty groups hidden; 0% match shown; 0..1 match hidden outside range; disabled toolbar/checkboxes; decorative icons `aria-hidden`; 32px min hit targets (`min-h-8`); toolbar wraps at 400px (`flex-wrap`). Browser not run (task rule).

**Verification**: `npm run verify -- -p @ptah-extension/onboarding` — test and typecheck succeeded; lint failed on an L1 file (untouched). L2 files: eslint 0 errors.

**Plan deviations**: guidance `run` is not copied on A3→A4 (see Decisions). Output names `toggled` / `clearSelection` instead of `toggle` / `clear` (native DOM events).

**Out-of-scope observations**: L1 `analyze-workspace.page.ts:4` unused `MultiPhaseAnalysisResponse` is the remaining lint error.

## Acceptance mapping (file:line)

| Requirement | Where |
| --- | --- |
| Within-owner key copy unchanged | `onboarding-step-link.ts:97-100`; spec `:32-49` |
| Agent → guidance never emits agent `run` | `onboarding-step-link.ts:111-121` (no `run` write); spec `:52-56`, `:67-75` |
| Agent → guidance always sets `gen` | `onboarding-step-link.ts:116-119`; spec `:52-65` |
| Guidance → done keeps `gen`+`tab`, drops `run` | `onboarding-step-link.ts:90-92`; spec `:77-81` |
| Backward A4 → A3: `tab`=`gen`, `run` omitted | `onboarding-step-link.ts:93-96`; spec `:84-88` |
| Unrelated owners still empty query | spec `:90-95` |
| Grouped list (legacy category order + Other) | `agent-recommendation-list.component.ts:11-18`, `:176-187` |
| Match % `round(score*100)` only when 0..1 | `:30-34`, `:115-135` |
| Criteria chips | `:141-154` |
| Toolbar select recommended / clear / n selected | `:57-86` |
| Inputs: recommendations, selection, disabled | `:164-166` |
| Outputs (page wiring) | `toggled` `:169`, `selectRecommended` `:170`, `clearSelection` `:172` |
| No store injection | component has no `inject()` |
| Glass tiles + decorative bot icon | `:93`, `:107-110`, `:149` |
| Shared type `AgentRecommendation` | import `:9` from `@ptah-extension/shared` |

## Decisions

1. **A3→A4 never copies `identity.run`.** Options: (a) never copy `run` (chosen); (b) copy `run` when `gen` is already set (treat as remapped guidance run); (c) invent a `guidanceRun` key. Evidence: required test uses a mixed identity with agent `run: 'run-1'` and leftover `gen`; copying `run` would emit the agent run (plan L15). A4 rebinds via `?run`, handoff `started()`, then authoritative state. Reversible: B3b can pass a remapped object later if a dedicated key is added.

2. **`gen` prefers prepared `identity.gen`, else current `tab`.** Options: (a) `gen ?? tab` (chosen); (b) always `tab` (breaks prepared handoff `{ tab: guidanceTab, gen: agentTab }`). Evidence: plan row “`gen` = the agent tab” plus B3b “handoff routes to A4 with `tab` = guidance tab, `gen` = agent tab”. Reversible: yes.

3. **Output names `toggled` and `clearSelection`.** Options: (a) task names `toggle`/`clear` (eslint `@angular-eslint/no-output-native` fails); (b) rename (chosen). Evidence: eslint on this file. ChooseAgentsPage should bind `(toggled)` and `(clearSelection)`. Reversible: alias if the page lane prefers other names.

4. **Match % treats `relevanceScore` as a 0..1 fraction.** Options: (a) 0..1 as design-spec A2 (chosen); (b) 0..100 as the shared type comment and legacy list. Evidence: task “hidden otherwise” and design-spec “derived `round(score*100)`, hidden if score is not 0..1”. Legacy 0–100 scores hide the badge. Reversible: yes, if A2 store normalises scores.

5. **No per-row Preview control.** Options: (a) omit (chosen); (b) add a `preview` output. Evidence: task output contract lists only toggle/selectRecommended/clear; overwrite preview is a sibling B3a file. Reversible: add later without store coupling.

6. **Agent glyph is Lucide `bot`, ignoring `AgentRecommendation.icon`.** Options: (a) always `bot` per §13.2 Agents (chosen); (b) map free-text `icon` strings. Evidence: addendum registration is per-component PascalCase `[img]`; `icon` values like `'server'` are not a typed Lucide set. Reversible: yes.

## Verification tail

```
✖ 122 problems (1 error, 121 warnings)
Warning: command "eslint ." exited with non-zero status code

 NX   Running targets lint, test, typecheck for project @ptah-extension/onboarding failed
Failed tasks:
- @ptah-extension/onboarding:lint
Output of 2 successful tasks were not shown.

  Run duration:      2m 48s
[verify 2026-10-30T10:39:34.376Z] lock released after 182.2s, exit code 1
```

L2 eslint (direct, 0 errors):
`npx eslint …onboarding-step-link.ts …onboarding-step-link.spec.ts …agent-recommendation-list.component.ts …agent-recommendation-list.component.spec.ts`

Foreign lint error (not edited):
`libs/frontend/onboarding/src/lib/analyze/analyze-workspace.page.ts:4` — `'MultiPhaseAnalysisResponse' is defined but never used`.

## Not done

- ChooseAgentsPage wiring (other lane).
- `onboarding.routes.ts`, analysis-step.store, overwrite-preview, setup-wizard (out of L2).
- Browser / visual review (forbidden this lane).
- Library-wide `npm run verify` green: blocked by L1 unused import above.
