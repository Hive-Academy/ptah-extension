# Phase 6 visual fix report: TASK_2026_596_0a19

Scope: `visual-review.md` findings 1, 2 and 5 only. Findings 3, 4, 6-9 were not touched.

## Finding 1 (visual breaking): dashboard header chip overlaps the owner title at 280 px

File: `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts`

- Header row: `flex items-start justify-between gap-3` became `flex flex-wrap items-start justify-between gap-x-3 gap-y-1` (plus `data-testid="section-header"`).
- Title block: `min-w-0` became `min-w-0 flex-1 basis-20`. The 5rem basis, instead of the subtitle's full max-content width, decides when the chip group wraps. It wraps only when the title would get less than 5rem.
- Status chip: added `whitespace-nowrap`, so the state word never breaks or truncates.
- Rendered result (recaptured):
  - 280: the `service-unavailable` chip and Refresh move to their own line under the title. Nothing overlaps (`dashboard-card-owners-anubis-280.png`, `-anubis-light-280.png`).
  - 360: the chip still sits beside the title, as before. The title wraps inside its own box ("Claude / account") and does not overlap (`dashboard-card-owners-anubis-light-360.png`).
  - 440: unchanged.
- Note: a first try with a 6rem basis made the chip wrap at 360 too. I narrowed it to 5rem so 360 and 440 stay as they were.

## Finding 2 (serious): focus ring under 3:1 in `anubis-light`

- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/stats-tile.styles.ts`: `TILE_FACE` changed `focus-visible:outline-info` to `focus-visible:outline-base-content`. This is the only focus-ring class under `plan-limits/**`, and the plan tile, lane tile and subtotal tile all use it.
- The token is already used for focus rings elsewhere in the repo, for example `libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts:19` and `cursor-credential-popover.component.ts:9`.
- Dashboard card: its only interactive elements are the daisyUI `btn btn-ghost btn-xs` Refresh buttons. The daisyUI 4.12.24 `.btn:focus-visible` rule (`node_modules/daisyui/dist/styled.css:1652`) sets no outline colour, so the ring is `currentColor`, which is base-content. They never used the info ring, so they were not changed.
- Theme values from `apps/ptah-extension-webview/tailwind.config.js`. I converted OKLCH to sRGB and computed WCAG relative luminance. The script reproduces the review's light `info` value of 2.59:1 on base-100 exactly. The ring has a 2px offset, so it is drawn over the surrounding surface; the tile fill is the composited value from the review.

| Ring vs background | `anubis` base-content `#e8e6e1` | `anubis-light` base-content `oklch(23.574% .066 313.189)` | Old `info`, light |
| --- | --- | --- | --- |
| base-100 | 14.86:1 | 15.91:1 | 2.59:1 |
| base-200 | 13.89:1 | 14.21:1 | 2.31:1 |
| base-300 | 12.29:1 | 13.21:1 | 2.15:1 |
| tile fill (dark 24,24,29 / light 243,238,235) | 14.18:1 | 14.74:1 | 2.40:1 |

Every pair is now at least 12.29:1, well above 3:1 in both themes. `outline-primary` was ruled out because light `primary` is `oklch(85% ...)`, a pale teal.

## Finding 5 (moderate): restored lane face showed "PTAH-CLI" and "Limit unknown"

Label:

- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`: `toStatsLimitLaneRun` now uses `agent.displayName || CLI_LABELS[agent.cli]`. `CLI_LABELS` is a typed `Record<CliType, string>` that maps `ptah-cli` to "Ptah CLI", `codex` to "Codex", and so on. The names match `tasks-ui/.../task-agent-discovery.service.ts:12`.
- The restored lane now reads "PTAH CLI" (the tile label is uppercased by CSS), not "PTAH-CLI".

Face state:

- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-tiles.ts`: the new `showsLastKnownEvidence(snapshot, same)` holds the one decision, "another account's owner, `service-unavailable`, shown from last-known evidence". Both the panel note (`ownerStatusNote`) and the face use it, so the two cannot disagree.
- When a subgroup is `unknown` and that decision holds, `lastKnownFace` builds the face and panel chip from the panel's own windows and evidence:
  - With at least one window that has a known value, it takes the most-used one: `◷ Last known · Weekly 60% used`, plus that window's source chips.
  - With only the owner's own evidence: `◷ Last known · limit evidence`.
  - Otherwise it returns nothing, and the face keeps "Limit unknown" (the panel shows no known value either).
- The lane state stays `unknown`, so the tile tone, the alternatives grouping and the no-room rule do not change. Only the wording follows the panel.
- G3/R7: the values come only from the lane's own owner snapshot, through the windows `windowDetail` already built for the panel. The current session owner's windows are never read. Specs pin this.
- `laneFaceChips` now groups subgroups by face chip text, in state order, instead of by state. A "Last known" subgroup and a "Limit unknown" subgroup therefore stay apart, each with its run wording.
- Recaptured: `stats-strip-expanded-anubis-light-440.png` shows "PTAH CLI · Restored · completed · ◷ Last known · Weekly 60% used · Provider API".

Specs:

- `stats-limit-view-model.spec.ts`:
  - Last-known face uses its own 60%, not the session owner's 40%; `state` stays `unknown`; `stateChip` and `limitChips` are equal.
  - Evidence only gives "Last known · limit evidence".
  - An unknown value keeps "Limit unknown".
  - In case (ii), no windows keeps "Limit unknown", so nothing is borrowed.
- `lane-usage-tile.component.spec.ts`:
  - The restored Ptah CLI lane renders "Ptah CLI" and "Last known · Weekly 60% used", has no "Limit unknown" on its face, and its panel reads "Different owner · Claude account" and "showing its last-known evidence".
  - The face focus ring is `outline-base-content`, not `outline-info`.
- `chat-view.component.spec.ts`: a bare run is labelled "Codex"; a restored `ptah-cli` run is labelled "Ptah CLI".
- `provider-account-card.component.spec.ts`, test 16b: header `flex-wrap`, title `min-w-0`, chip `whitespace-nowrap`.

## Files modified

- `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\dashboard\src\lib\components\provider-account-card\provider-account-card.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\dashboard\src\lib\components\provider-account-card\provider-account-card.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\stats-tile.styles.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\lane-tiles.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\stats-limit-view-model.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\lane-usage-tile.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat\src\lib\components\templates\chat-view.component.spec.ts`

Rules held:

- No `text-base-content/NN` classes.
- OnPush and signals are unchanged.
- chat-ui imports only `@ptah-extension/shared`; no orchestrator lib.
- No settings files changed.
- No git operations.

## Verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui @ptah-extension/chat @ptah-extension/dashboard ptah-extension-webview`:
  - **Successfully ran targets typecheck, test, lint for 4 projects.**
  - The first run caught a type-predicate narrowing error in `lane-tiles.ts` and one spec setup error (session owner missing from `owners`). I fixed both and re-ran the command to green.
  - After the last dashboard basis tweak, I re-ran `typecheck,test,lint -p @ptah-extension/dashboard`: success.
- `npx nx build ptah-extension-webview`: **Successfully ran target build** after the final change. Nx Cloud printed its 401 plan notice, which does not affect the build.
- Capture: from `libs/frontend/webview-e2e-harness`, `SHOT_DIR=...\screenshots npx playwright test --config=playwright.config.ts plan-limits-visual --workers=2`: **12 passed (21.6s)** on the final build.
- I inspected the recaptured screenshots for 280 and 360 (both themes) on the dashboard card and for 440 light on the stats strip.
