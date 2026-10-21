# Electron visual review, run 2

**Verdict: REVISE — 3/10.** Five visual defects: four visual breaking, one serious. All 24/24 screenshots were captured in dark and light themes at 1440×900 and 800×900. The score is below run 1's 4/10 because its three blocking defects remain and the prohibited floating badge is visible. It is above 1–2 because the bell, request projection, and empty/clear states still render and remain usable.

## Build and capture evidence

`npx nx build ptah-electron --parallel=1` succeeded once (12 tasks, exit 0), producing `dist/apps/ptah-electron/main.mjs` and renderer assets. Nx Cloud could not upload its cache (401), but the local build succeeded. The one `node .ptah/specs/TASK_2026_593_7c2e/visual-check/shoot-populated.cjs` run produced [capture-results-2.json](../visual-check/capture-results-2.json): 24/24 shots, zero script errors, `portFreeAfter=true`, `tempRemoved=true`. An independent check found no listener on port 9347 after capture. The script launched the built Electron entry and verified the renderer `file:` URL before capture. No application source was edited.

Approved reference: [design-spec.md](design-spec.md) and [prototype/attention.html](prototype/attention.html), including its [full screenshot](prototype/screenshots/full.png). The reference requires one filled primary request action, the Needs you status inside the session card, kind first in queue cards, and a bottom-right snackbar stack that leaves Stats visible.

Key absolute evidence paths:

- Dark rail: `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-rail-needs-you.png`
- Light rail: `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-rail-needs-you.png`
- Best dark snackbar stack: `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-stack.png`
- Best light snackbar stack: `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-stack.png`

## Status of run-1 defects

| Run-1 defect | Status and evidence |
| --- | --- |
| 1. Rail primary action lacks a filled treatment | **Unfixed.** [Dark rail](../visual-check/dark-rail-needs-you.png) and [light rail](../visual-check/light-rail-needs-you.png) show Allow, Deny and Show in canvas as plain text in the queue and tab card. The shared permission action template applies `btn btn-ghost` to every action at `libs/frontend/core/src/lib/components/attention-permission-actions.component.ts:16-19`. The tab card has a conditional `btn-primary` at `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts:180`, but the resulting screenshot still has no filled Allow. |
| 2. Needs you status sits outside the card frame | **Unfixed.** In both rail shots, the visible session card border ends near y=435 and the Needs you line appears near y=480. The wrapper at `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts:171-191` contains an inner compact card (`:195-208`); its visible inner frame still excludes the attention block despite the wrapper styling (`:115-130`). |
| 3. Snackbar stack covers Stats | **Unfixed.** [Dark stack](../visual-check/dark-snackbar-stack.png) and [light stack](../visual-check/light-snackbar-stack.png) show cards from about y=65–525 over the session title, Context, Tokens/Cost and Agents region. The single-card [dark 800](../visual-check/dark-800.png) and [light 800](../visual-check/light-800.png) shots cross the session header and controls. The host rule declares `bottom: 5rem; right: 1rem` at `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts:20`, but the captured placement is at the top right; the reason that resolved positioning differs from the source rule was not established. |

## New defects

1. **Visual breaking — round floating warning-triangle badge remains.** [Dark rail](../visual-check/dark-rail-needs-you.png) and [light rail](../visual-check/light-rail-needs-you.png), 1440×900, show a circular blue/turquoise badge with a warning triangle and red count at the lower-right Stats edge. It is also visible in both live bell shots. This explicitly prohibited duplicate permission surface competes with the rail and bell. Source owner was not isolated; the observed routed permission state and screenshot are the evidence. The screenshot is from a real `permission:request`, not a projected placeholder.
2. **Serious — queue cards put session title before request kind.** [Dark rail](../visual-check/dark-rail-needs-you.png) and [light rail](../visual-check/light-rail-needs-you.png), 1440×900, show “Attention capture” first and “Permission: Bash” second. The approved prototype puts the kind first so the user can identify the needed response while scanning. `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:193-199` renders the kind before the title in source, so the captured mismatch may come from how the built queue card is styled or from a different rendered path; verify the compiled template and resolved layout when fixing it.

## Per-shot review

“Pass” means the pictured state has no additional visible issue beyond the findings above. Every path below is absolute. The failures identify the pictured finding; the table does not claim unphotographed focus or hover behavior.

| Screenshot path | Theme | Viewport | Result | Note |
| --- | --- | --- | --- | --- |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-permission.png` | Dark | 1440×900 | Fail | Single card covers Stats; unavailable target action is disabled. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-question.png` | Dark | 1440×900 | Fail | Single card covers Stats. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-lane.png` | Dark | 1440×900 | Fail | Single card covers Stats. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-failure.png` | Dark | 1440×900 | Fail | Failure card covers Stats; kind, detail and action remain readable. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-stack.png` | Dark | 1440×900 | Fail | Three cards cover Stats; +3 more shown. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-bell-badge.png` | Dark | 1440×900 | Fail | Bell count is visible; stack still covers Stats. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-panel.png` | Dark | 1440×900 | Pass | Bell panel shows Needs you and Recent cards with internal scroll. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-panel-clear-all.png` | Dark | 1440×900 | Pass | Recent cleared, five pending requests remain. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-panel-empty.png` | Dark | 1440×900 | Pass | All clear state visible; no card overflow. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-800.png` | Dark | 800×900 | Fail | One snackbar covers compact header and action controls. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-rail-needs-you.png` | Dark | 1440×900 | Fail | Rail primary, frame, kind order, floating badge. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-panel-permission-live.png` | Dark | 1440×900 | Fail | Bell permission is legible with filled Allow; rail defects and badge remain. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-permission.png` | Light | 1440×900 | Fail | Single card covers Stats; unavailable target action is disabled. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-question.png` | Light | 1440×900 | Fail | Single card covers Stats. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-lane.png` | Light | 1440×900 | Fail | Single card covers Stats. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-failure.png` | Light | 1440×900 | Fail | Failure card covers Stats; kind, detail and action remain readable. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-stack.png` | Light | 1440×900 | Fail | Three cards cover Stats; +3 more shown. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-bell-badge.png` | Light | 1440×900 | Fail | Bell count is visible; stack still covers Stats. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-panel.png` | Light | 1440×900 | Pass | Bell panel shows five Needs you rows and internal scroll. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-panel-clear-all.png` | Light | 1440×900 | Pass | Recent cleared, five pending requests remain. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-panel-empty.png` | Light | 1440×900 | Pass | All clear state visible; no card overflow. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-800.png` | Light | 800×900 | Fail | One snackbar covers compact header and action controls. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-rail-needs-you.png` | Light | 1440×900 | Fail | Rail primary, frame, kind order, floating badge. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-panel-permission-live.png` | Light | 1440×900 | Fail | Bell permission is legible with filled Allow; rail defects and badge remain. |

## Limitations

- No screenshot shows the full new permission decision set (Allow, Always allow, Deny, Deny with message) or a tool input preview. The live bell card shows Allow, Deny, Show in canvas and “Tool: Bash”; its legibility is visible, but the extra decisions, preview, expanded denial form and focus ring cannot be judged from these shots. The synthetic unroutable cards have disabled Show in canvas.
- The script did not capture a live snackbar while Tasks was visible in either theme; it recorded suppression after five seconds. The screenshot evidence for snackbar layout comes from projected requests and a real voice provider failure.
- 800×900 coverage includes one snackbar with collapsed Sessions. The script did not open the compact Sessions sheet, and no 400px viewport was authorized in this run. Keyboard focus, hover, contrast ratios and layout shift during animation were not measured. The screenshots show no clear text clipping in the photographed cards; they do not prove contrast or focus compliance.
- Lane permissions were projected without a live agent, and the failure card came from `voice:providerError` because the synthetic tab had no failed Claude turn. The light theme also showed a Git status read error in Stats; that is outside the attention-card review.

## Decisions

- **Decision:** Keep REVISE. **Options:** approve the new wrapper and source class changes, or judge the built Electron screenshots against the approved visual result. **Evidence:** the paired rail and stack shots show all three run-1 failures after the fresh build. **Reversible:** yes.
- **Decision:** Treat the floating badge as a visual defect while keeping its source cause unresolved. **Options:** attribute it to a guessed component, or cite the observed routed permission state. **Evidence:** paired live rail and bell screenshots, plus `capture-results-2.json` describing the real request. **Reversible:** yes.
