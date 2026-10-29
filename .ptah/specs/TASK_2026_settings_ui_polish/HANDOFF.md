# HANDOFF — Settings UI polish (Electron first)

Date: 2026-10-29 (session 2). Replaces the session-1 handoff.

> Closed in session 3: the 94 px BLOCKER is fixed ("Used by N · Used for: …" is one truncating
> segment; 80 px gate kept). Harness settings 129 passed / 2 skipped; visual Round 6 and
> code-style follow-up round 2 APPROVED; `_tmp-*` files deleted. The rest of this file is history.

## Goal

Polish the presentation of the Settings page in the Electron app. Change only templates,
Tailwind/DaisyUI classes, layout and component CSS. Do not change the backend, RPC, state
services, stores or save/undo logic. Keep every data-testid, aria label and internal tab id
(for example 'orchestration'), except ids that belonged to the deleted Routing map.

User concerns (all addressed, see "Done"):
1. Main agent clear at the top of the Providers tab, Reassign easy to find.
2. Connections: one clean list, one "Connect provider" entry point.
3. CLI matrix readable at 1024 and 1440 px.
4. Glass theme: use the existing glass roles; check Light, Dark and Glass.
5. Size scale: no btn-xs / text-[10px] / text-[11px] on the touched surfaces.
Added in session 2 by the user:
6. Main agent and Connections on the SAME card (with a hairline between them).
7. Ptah CLI instances separated from the system CLI lanes in the CLI matrix card (same card, a
   small separator, an organized per-instance view with model tiers, a clear way to add one).
8. Settings page background must follow the glass theme.
9. Context Management tab must be centered and look like the other tabs.

## Location

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\settings-ui-polish`
- Branch: `refactor/settings-ui-polish`, from `origin/main` at `ba0f98271`.
- `node_modules` in the worktree is a directory junction to the main checkout.
- Task folder (untracked): `.ptah/specs/TASK_2026_settings_ui_polish/`
  - `design-spec.md`, `code-style-review.md` (final round + follow-up round, APPROVED 7.5/10),
    `visual-review.md` (rounds 1–5; round 5 APPROVED 8.7/10).
  - Screenshots: `screenshots/after-r3/`, `after-r3-fix/`, `after-r4/`, `after-r5/` (real Electron).

## Status

- Commits: NONE. Push: NONE. PR: NONE. All work is uncommitted in the worktree
  (47 tracked files changed, +945 / -1797, plus the untracked files below).

### Done (session 2)

- Glass decision (user): Settings section cards use the existing BLURRED `chrome` role.
  `SurfaceSectionComponent` (libs/frontend/ui) has a new `glassSurface` input
  ('content' | 'chrome', default 'content'). Host class `has-[[role=dialog]]:relative z-30` keeps
  popovers above sibling cards. `styles.css` is NOT changed (generated glass layer).
- Main agent: `providers/main-agent-section.component.ts` (+ spec) is a plain block. It shares ONE
  chrome card (`providers-main-connections-card`) with Connections (`providers-connections-card`,
  `border-t border-base-content/15`).
- Routing map deleted completely (`routing-map*.ts` + specs, harness
  `settings-routing-map.entries.ts` → `settings-main-agent.entries.ts`, RM-2/RM-3 removed,
  `EXPECTED_CAPABILITY_COUNT` 140 → 138, reachability `#83` retargeted to the drawer link
  "Follows main agent →").
- Ptah CLI instances: new `ptah-ai/ptah-cli-instances.component.ts` (+ spec) under a hairline in the
  CLI matrix card: one card per instance (provider, status/key, toggle, tier mapping
  Sonnet/Opus/Haiku with "Not set", "Last test", Tiers/Test/Edit/Delete, Add button, empty state).
  Shared constants in `ptah-ai/cli-matrix-styles.ts`; `CLI_TEST_*`, `cliTestFailedText()`,
  `PtahCliInstance*` and `CliMatrixCellField` types in `ptah-ai/cli-matrix-rows.ts`.
  Harness `#42` now checks the instance card.
- Glass page background: the Settings root is the only page background (transparent in glass);
  the Providers page lost its own `bg-base-100`.
- Glass 1024 overflow fixed: matrix narrow `@container (max-width: 39.99rem)` cell padding 4 px;
  hidden order-chip measuring copy clipped (`agent-orchestration-config.component.ts`).
- btn-xs → btn-sm on the Providers tab (copilot toggle, decision-model row/key field,
  add-cli-instance modal, tier-mapping modal). Reassign popover `w-[21rem]`. "Context Management"
  tab label wraps instead of an ellipsis (`settings.component.ts`).
- Context Management: `max-w-5xl` removed, root `flex flex-col gap-4 py-3`, titles `text-base`.
  Advanced tab root has `py-3`. Search & Voice keeps no `py-3` (its 660 px fold gate fails at 665).
- Connection rows: sub-line wraps between whole segments; tier chips use `break-all`.
- LAST EDITS (by the coordinator, after round 5, NOT yet visually checked):
  - `provider-connection-card.component.ts`: each "·" now ends the segment before it (no leading
    separator on a wrapped line); host `block h-full` and `ptah-native-card` `block h-full
    [&>div]:h-full` so side-by-side rows end at the same bottom edge.
  - Hairlines `border-base-content/15` in `providers-settings.component.ts:227` and
    `ptah-cli-instances.component.ts:68` (spec pin updated).
  - Spec `provider-connection-card.component.spec.ts:143` now expects `'Used for: …'`.
  - `npm run verify -- -p @ptah-extension/chat` → 3 tasks succeeded after these edits.

### Verification results (latest)

- `npm run verify -- -p @ptah-extension/chat,@ptah-extension/webview-e2e-harness,ptah-electron-e2e,@ptah-extension/ui`
  (before the LAST EDITS): 8 succeeded, 2 failed — only `ptah-electron-e2e:lint` (known
  `git-watcher.spec.ts` fs.watch errors) and `ptah-electron-e2e:typecheck` (only in
  `_tmp-fixtures-copy.ts`; disappears when the `_tmp-*` files are deleted).
- `npm run verify -- -t typecheck -p ptah-extension-webview`: pass.
- `npm run verify -- -t test -p ptah-extension-webview -- --testPathPatterns="glass|state-ink"`: pass.
- Harness `src/lib/scenarios/settings/` (previous build): 126 passed + reachability 9/9 +
  advanced-search-voice 8/8 after the Search & Voice revert. Known flaky under load:
  providers "popover model … Undo" (passes 4/4 in isolation); one Playwright worker crash.
- A final rebuild + full harness run was started at handoff time (see "In progress").

## In progress at handoff — BLOCKER from the LAST EDITS

- Final rebuild + full harness settings run (with the LAST EDITS): 125 passed, 2 skipped,
  4 FAILED — all VS Code:
  - `settings-visual.e2e.spec.ts:913` "baseline smoke — Providers fold and Main agent section"
    (vscode, anubis / anubis-light)
  - `settings-visual.e2e.spec.ts:1326` "live-shaped values — Batch 52" (vscode, anubis / anubis-light)
  - Cause: connection card height 94 px > the 80 px gate at `settings-visual.e2e.spec.ts:252`
    ("Compact cards (≤ 80 px)"). Before the LAST EDITS these tests passed.
  - Likely cause: the new `h-full` stretch (host `block h-full` + `ptah-native-card`
    `block h-full [&>div]:h-full` in `provider-connection-card.component.ts`) makes each row as tall
    as the tallest row, and/or the new "·" wrapper lets a sub-line wrap to a third line in the
    narrow VS Code columns.
  - Fix first: find which one (remove the `h-full` classes and re-run the harness). Prefer keeping
    the ≤ 80 px gate. If equal row bottoms need the stretch, cap the sub-line at two lines
    (`line-clamp`) or accept ragged bottoms (the round-5 finding was only Moderate). Do not relax
    the gate without asking the user.
- The LAST EDITS also need a short real-Electron confirmation (next step 3).

## Open problems and decisions

1. Commit the task folder `.ptah/specs/TASK_2026_settings_ui_polish/` (reviews + screenshots)? Not
   decided — ask the user, or leave it untracked (default: do not commit screenshots).
2. Out of scope, report in the PR: global `.badge { font-size: 10px }` at
   `apps/ptah-extension-webview/src/styles.css:1999` (app-wide); btn-xs on output-style, voice,
   pro-features, drawer tabs; raw `content` (non-blurred) cards on Advanced / Search & Voice.
3. VS Code gate relaxations from session 1 (columnsAt1024 3→2, `card5` removed from VS Code fold
   regions, title height ≤21 px, label/value tolerance 4→6 px) — mention in the PR.
4. Harness `capture()` overwrites `.ptah/specs/TASK_2026_555/screenshots/angular/`. After EVERY
   harness run: `git checkout -- .ptah/specs/TASK_2026_555` and check `git status`.
5. `cli-orchestration-matrix.component.ts` is still ~1300 lines (was ~1600).

## Key files

- `libs/frontend/chat/src/lib/settings/providers/`: `providers-settings.component.ts`,
  `main-agent-section.component.ts`, `provider-connection-card.component.ts`,
  `main-agent-reassign-popover.component.ts`, `decision-model-*.ts`, `add-cli-instance-modal`,
  `cli-tier-mapping-modal`.
- `libs/frontend/chat/src/lib/settings/ptah-ai/`: `cli-orchestration-matrix.component.ts`,
  `ptah-cli-instances.component.ts`, `cli-matrix-rows.ts`, `cli-matrix-styles.ts`,
  `orchestration-settings.component.ts`, `agent-orchestration-config.component.ts`.
- `libs/frontend/chat/src/lib/settings/settings.component.{html,ts}`.
- `libs/frontend/ui/src/lib/surfaces/surface-section.component.ts`.
- Harness: `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/` (visual, reachability
  table, cli-matrix entries, main-agent entries).
- Temp capture specs (DELETE before commit): `apps/ptah-electron-e2e/src/specs/settings/_tmp-*.ts`
  (5 files; `_tmp-r5-shots.spec.ts` is the newest, with full mocks), and
  `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/_tmp-settings-{shots,contrast}.e2e.spec.ts`.

## Next steps

1. `cd D:\projects\ptah-extension\.claude-worktrees\settings-ui-polish`; `git status`.
   Fix the BLOCKER above (connection card > 80 px in VS Code) with a fresh frontend-developer,
   then `npm run verify -- -p @ptah-extension/chat`.
2. Rebuild and run the harness (each under the lock):
   - `node scripts/verify.mjs --exec --task settings-copy -- npx nx copy-renderer-dev ptah-electron --skip-nx-cache`
   - from `libs/frontend/webview-e2e-harness`:
     `node ../../../scripts/verify.mjs --exec --task settings-harness -- npx playwright test --config=playwright.config.ts --reporter=line src/lib/scenarios/settings/`
   - `git checkout -- .ptah/specs/TASK_2026_555`
3. Short real-Electron check of the LAST EDITS (visual-reviewer): re-run `_tmp-r5-shots.spec.ts`
   via `node scripts/verify.mjs --exec --task settings-shots -- <playwright cmd>` (find the command
   in `apps/ptah-electron-e2e/project.json`); check no leading "·", equal row bottoms at 1440, and
   hairline visibility in dark/glass. Append "Round 6" to `visual-review.md`.
4. Optional short code-style review of the LAST EDITS.
5. Delete all seven `_tmp-*` files. Then run:
   `npm run verify -- -p @ptah-extension/chat,@ptah-extension/webview-e2e-harness,ptah-electron-e2e,@ptah-extension/ui`
   (only `ptah-electron-e2e:lint` git-watcher errors may remain) and
   `npm run verify -- -t typecheck -p ptah-extension-webview`.
6. Confirm `git status` shows only task files and no changes under other tasks' `.ptah/specs/`.
7. Read `.commitlintrc.json`. Commit in the FOREGROUND, staging files by explicit path (include the
   deleted routing-map files with `git add -u <paths>` or `git rm`). Suggested subject:
   `refactor(chat,ui,webview-e2e-harness): polish settings providers and glass`
   (≤72 chars; body lines ≤100, wrap at 72). End with
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
8. Push + `gh pr create --base main` as ONE background command. Title <70 chars; body
   `## Summary` + `## Test plan` with the real results above, the checks that did not run, the
   out-of-scope items and VS Code gate relaxations; end with
   `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
9. Watch CI and reviews with `gh` (background watcher). Fix confirmed findings with NEW commits.
   Never force push, never merge, keep the worktree and branch.

## Repository rules (repeat to every subagent and lane)

- Verify only with scoped `npm run verify -- -p ...`. Never workspace-wide checks or `nx run-many`.
  Build/e2e only for the visual check, always via
  `node scripts/verify.mjs --exec --task <name> -- <command>`. Do not raise Nx/Jest parallelism.
- Known pre-existing lint errors: ptah-electron-e2e `git-watcher.spec.ts` (fs.watch).
- Angular: standalone, OnPush, signals, input()/output(), inject(); no any/@ts-ignore/`as unknown as`.
- Electron first; screenshots and visual review in Electron only; keep VS Code compiling.
- Only the coordinating agent commits, pushes and manages the PR.
