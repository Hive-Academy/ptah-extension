# HANDOFF — TASK_2026_710: glass theme / PR #805

Updated 2026-10-22 (late evening). Read this file FIRST. It replaces all earlier handoffs in this path
(earlier history is in git: `git show 6ca25c128:.ptah/specs/TASK_2026_710_ptah-glass-theme/HANDOFF.md`).

## Status 2026-10-23 (supersedes "UNCOMMITTED" and "Exact next steps" below)

- Codex review of toast/drawer/dropdown/marketplace: REVISE 6 → REVISE 8 → APPROVED 9/10
  (`code-logic-review-e2e-fixes-r2.md`, 2 of 2 rounds used).
- Local checks passed: theme-toggle Jest 17, ui dropdown+drawer Jest 40, settings-toast Jest 12,
  typecheck chat-ui ui chat ptah-extension-webview (4 projects), Electron build-dev + copy-renderer-dev,
  Electron playwright compaction-duplicate-session + theme.spec: 7 passed.
- Electron visual re-check dark + light: PASS (see `visual-review-electron.md` last section).
- Code committed as `f72035ac5`; docs in the next commit. Then push and watch `gh pr checks 805`.
- Still open: native-autocomplete in-page overlay; toast re-stack limitation; merge #805 and close #799
  need user permission.

## Goal

Ship the approved C4 glass theme pair (`ptah-glass` dark, `ptah-glass-light`) as the defaults, Electron
first, and make implementation PR #805 merge-ready: CI green and Electron visual acceptance in dark and
light. The user asked: "fix and make sure the pr is ready to be merged". The user did NOT authorize a
merge — merging and closing PR #799 stay user decisions.

Fixed decisions (unchanged): C4 design; static SVG backdrop; accents gold (default, absent `data-accent`),
rose, moonstone; stock glass opt-in only for dark, nord, cupcake, dracula; lofi stays flat; authoritative
state wins over the localStorage mirror.

## Location

- Worktree (work ONLY here): `D:/projects/ptah-extension/.claude-worktrees/ptah-glass-theme`
- Branch: `feat/ptah-glass-theme`. Remote head: `6ca25c128`.
- Task folder: `.ptah/specs/TASK_2026_710_ptah-glass-theme/`
- PR #805 (open): https://github.com/Hive-Academy/ptah-extension/pull/805
- PR #799 (draft prototype, outdated): keep until #805 merges; close only with user permission.
- `.gitignore` has an unrelated modification (`.opencode/agent/`). Never stage, revert or include it.
- `node_modules` is a junction; never npm install or delete it.

## Done and pushed

- `52d280b8a` fix(webview,chat-ui,ui,chat,e2e): repair glass popups and theme picker
  (::after blur layers, shell-only background clearing, top-layer native popover, picker tabs redesign
  with ink/height refresh and aria-haspopup="dialog", marketplace helper throws, anubis axe helper).
- `6ca25c128` docs(task-specs): reports and reviews.
- CI on `6ca25c128`: Electron shard 2 (contrast) fixed. Still failing at that head: Electron shard 4
  `theme.spec.ts:121/146/213`, shard 1 `compaction-duplicate-session.spec.ts:52`, webview
  `marketplace-visual.e2e.spec.ts:179`, `settings-reachability.e2e.spec.ts:79` (both modes).
  Main passes all of these.

## Done locally — UNCOMMITTED (round of 2026-10-22 evening, user-authorized)

| Area | Files | Author | Review | Local evidence |
|---|---|---|---|---|
| theme.spec tabs + select all 36 | `apps/ptah-electron-e2e/src/specs/theme/theme.spec.ts` | Claude subagent | codex APPROVED after rev 1 (`code-logic-review-picker-fixes-r2.md`) | NOT run |
| Picker selected-tab contrast | `theme-toggle.component.ts` (643 lines), `.spec.ts` | Claude subagent | same review APPROVED | spec not re-run after this change |
| Visual fixes D1 header under modal scrim, D2 glass-light code contrast, D4 model chip, D5 menu fill, D6 gap | `apps/ptah-extension-webview/src/styles.css`, `model-selector.component.ts` | codex | Claude APPROVED after rev 1 (`code-logic-review-visual-fixes-r2.md`) | no Electron render yet |
| Toast in top layer (settings A2) | `libs/frontend/chat/src/lib/settings/feedback/settings-toast.component.ts` | Claude subagent | NOT independently reviewed | settings-reachability passes both hosts locally; jest passes |
| Drawer in top layer (vscode ADV-14/15/17) | `libs/frontend/ui/src/lib/native/drawer/native-drawer.component.ts` + spec | Claude subagent | NOT reviewed | covered by the reachability run above; jest passes |
| Dropdown in top layer (compaction B) | `libs/frontend/ui/src/lib/native/dropdown/native-dropdown.component.ts` + spec | Claude subagent | NOT reviewed | jest passes; Electron compaction spec NOT run |
| Marketplace timing (A1) | `marketplace-visual.e2e.spec.ts` (120s timeout with measured reason; WeakMap chrome-gap cache) | Claude subagent | NOT reviewed | passes locally |

Reports: `picker-fixes-r2.md`, `visual-fixes-r2.md`, `e2e-fixes-r2.md`, `visual-review-electron.md`
(the review that found D1–D6; screenshots in `shots-review/`, script `shoot-electron-review.cjs`).

Root cause common to D1, B, A2 and the drawer: glass surfaces use `isolation: isolate`, so in-page
`position: fixed` overlays are trapped in their pane's stacking context. Fix pattern: render overlays in the
browser top layer (`popover="manual"` shell + `showPopover()`), as `native-popover` does.

## Open problems / decisions

1. The e2e-investigator's changes (toast, drawer, dropdown, marketplace spec) need an independent review by a
   different family (codex) before commit.
2. Electron compaction spec (`compaction-duplicate-session.spec.ts:52`) not run locally after the dropdown
   fix.
3. `native-autocomplete` (libs/frontend/ui/src/lib/native/**) is the only remaining in-page fixed overlay;
   probably has the same isolation defect. Not changed. Decide whether to convert it.
4. Known limitation: an already-visible toast stays under a drawer/popover opened after it until the next
   toast re-stacks.
5. Electron visual acceptance of this round is still missing (D1 scrim blocks header in dark+light, D2/code
   header contrast in light, picker selected tab, model chip at narrow width, popover/dropdown/drawer above
   modals). Note: `build-dev` leaves the renderer stale — also run `copy-renderer-dev`.
6. Older open review `code-logic-review-ci-r2.md` (REVISE) concerned the marketplace helper and ::after
   change; the marketplace part is now addressed by measured timing; ::after needs the visual check above.
7. Revision budget for this round: picker and visual lanes each used 1 of 2 revision rounds.
   The e2e-investigator work has had 0 reviews so far.

## Heavy-check slot

Released by this session at wrap-up. Queue at that moment: skill-routing (PR #807, one push) →
TASK_2026_712 (one push) → TASK_2026_714 (typecheck + one Jest). Before any heavy run: `ListAgents`, then
claim the slot with `SendMessage` to the peers and wait for "released". One heavy check at a time.

## Lanes

All TASK_2026_710 lanes and subagents are terminal. Last list: codex confirmed room (weekly ~31%),
grok near limit (92%), opencode and Glm AT LIMIT. The temporary CLAUDE.md "no Claude subagents" rule
(expires 2026-10-24) was overridden by the user for this task ("make sure you utilize your own subagents").

## Exact next steps

1. Read this file, then `e2e-fixes-r2.md`. Inspect `git status` / `git diff --stat` in the worktree.
2. Independent codex review of: settings-toast, native-drawer, native-dropdown (+ specs), marketplace spec.
   Fix findings with at most 2 revision rounds.
3. Claim the heavy-check slot, then run one at a time (filter output):
   - `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.spec.ts --coverage=false --maxWorkers=2`
   - `npx nx run-many -t typecheck -p chat-ui ui chat ptah-extension-webview --parallel=1` (confirm the header says 4 projects)
   - `npx nx run ptah-electron:build-dev --parallel=1` then `npx nx run ptah-electron:copy-renderer-dev`
   - `cd apps/ptah-electron-e2e && npx playwright test --config=playwright.config.ts --workers=1 compaction-duplicate-session theme/theme.spec.ts`
4. Electron visual check in dark and light (reuse `shoot-electron-review.cjs`), for the items in open problem 5.
   Update `visual-review-electron.md`.
5. Commit in the foreground (read `.commitlintrc.json`; stage files explicitly, never `.gitignore`), push in the
   background, then `gh pr checks 805` until all checks finish. Fix only real CI failures.
6. Report to the user: CI state, visual evidence, open items. Do NOT merge or close PR #799 without permission.
