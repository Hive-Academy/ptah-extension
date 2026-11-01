# B4b proposal visual capture report

| State | Test name | Route | Mocked RPCs | Asserted element |
| --- | --- | --- | --- | --- |
| New project intake | `new-project-intake`, `narrow-new-project-intake` | `/onboarding/new-project` | Boot map includes `harness:start-new-project`; no action RPC | `new-project-intake`, brief textbox |
| Intake errors | `new-project-intake-errors`, `narrow-new-project-intake-errors` | `/onboarding/new-project` | No action RPC; empty submit is local validation | Error summary alert and `#project-what-error` |
| Team builder start | `team-builder-start`, `narrow-team-builder-start` | `/onboarding/team-builder` | Boot map includes `harness:workflow-prompt`; no action RPC | `team-builder-start`, Start team builder button |
| First revision | `workspace-first-revision`, `narrow-workspace-first-revision` | `/onboarding/new-project/workspace?tab=e2e-proposal-tab` | `harness:get-proposal` (one revision), `harness:load-presets` | Proposal panel, Revision 1, From your intake, bundled plugin |
| Second revision | `workspace-second-revision`, `narrow-workspace-second-revision` | Same workspace route | `harness:get-proposal` (two revisions), `harness:load-presets` | Revision 2, New and Changed tags, open revision history |
| Answer sheet | `narrow-workspace-answer-sheet` | Same workspace route | `harness:get-proposal` (two revisions), `harness:load-presets` | Modal dialog visible and reply textbox focused |
| Unavailable | `workspace-unavailable`, `narrow-workspace-unavailable` | Same workspace route | `harness:get-proposal` returns `{ proposal: null }` | Proposal unavailable heading and Start over button |
| Pinned review | `review-pinned`, `narrow-review-pinned` | `/onboarding/new-project/review?tab=e2e-proposal-tab&rev=proposal-revision-1` | `harness:get-proposal` (two revisions) | Newer revision banner naming Revision 2 |
| Current review | `review-current`, `narrow-review-current` | Review route with `rev=proposal-revision-2` | `harness:get-proposal` (two revisions) | Enabled Apply to Workspace button |
| Apply result | `apply-result`, `narrow-apply-result` | Review route with `rev=proposal-revision-2`; return via workspace | `harness:get-proposal`, `harness:apply`, `harness:health`, `harness:load-presets` | Applied revision, applied paths, Warnings, Done |

## Data test IDs

None. Existing page test IDs, headings, roles, and accessible names cover every state.

## Skipped states

None.

## Decisions

- The spec follows the generate visual pattern: `test.use({ useAppBuild: true })`, four `ONBOARDING_THEMES`, 1280×800 and 464×800 viewports, `narrow-` names, `captureOnboarding`, and an axe annotation. Output is `resolve(ONBOARDING_ANALYZE_CAPTURE_DIR, '../proposal')`.
- The suite defines 76 captures: nine shared states at two sizes plus the narrow answer sheet, across four themes.
- The fixture seeds a real Electron workspace path, controller session record, tab, and stack profile before Angular starts. It returns one or two durable proposal revisions through `harness:get-proposal`. Revision 2 changes the name and adds a prompt, yielding Changed and New tags from folded snapshots.
- The successful apply returns two workspace paths and one warning. The capture re-enters review after applying because the result component shows its full path and warning details when the persisted receipt is revisited.
- `harness:start-new-project` and `harness:workflow-prompt` are mocked for the start pages; the empty and validation states do not submit a valid brief. `harness:load-presets` answers the mounted preset section; `harness:health` answers the apply refresh. The shared analyze fixture map covers shell boot RPCs.
- No Playwright or app run was performed, per task instruction. The Angular skill was found and read at `.claude/skills/angular-frontend-patterns/SKILL.md`; this CLI exposed no native skill invocation tool, so direct file reading was the fallback.

## Verification

- Command: `npm run verify -- -t lint,typecheck -p @ptah-extension/webview-e2e-harness`
- Result: exit code 0 after waiting for the shared verification lock.
- NX summary: `NX   2 tasks: 2 succeeded`
- NX summary: `Run duration:      17.7s`
- NX summary: `Cache:             0/2 hit (0%)`
- E2E, build, serve, dev, package, and workspace-wide targets: not run.
