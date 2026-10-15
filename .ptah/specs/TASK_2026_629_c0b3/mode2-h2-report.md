# Mode 2 H2 report - Batch R9f - TASK_2026_629_c0b3

Verdict: **FAIL (BATCH R9f NOT ACCEPTED)**. Tests and typecheck pass. Lint fails with 9 errors, all in the
R9f file `canvas-detail-transcript.component.spec.ts`. Batch state stays IN_PROGRESS. It is not VERIFIED, so
the commit command below must wait until a lint fix lands and LINT(canvas) passes again.

Inputs read: batches-rail-r9.md "Batch R9f", code-logic-review-R9f.md (REVISE 5/10), lane-R9f-fix-report.md,
code-logic-review-R9f-fix.md (APPROVE-WITH-FIXES 7/10), lane-R9f-correction-report.md, decisions rows 77, 89,
93, 97, 98. `code-logic-review-R9f-correction.md` did not exist when this report was written, so its findings
are not included here.

## Scope check

`git status --short libs apps` lists exactly the 10 R9f paths and nothing else:

- M `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts`
- M `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.spec.ts`
- M `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts`
- M `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.spec.ts`
- M `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts`
- M `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.spec.ts`
- M `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.ts`
- M `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.spec.ts`
- M `libs/frontend/canvas/src/lib/canvas-session-overrides.ts`
- ?? `libs/frontend/canvas/src/lib/canvas-session-overrides.spec.ts`

Outside libs/apps, the only changes are task-folder documents. They are not part of the R9f commit.

## Checks (run from W, one at a time, through the machine-wide lock; logs in %TEMP%)

| # | Label | Command | Result |
| --- | --- | --- | --- |
| 1 | r9f-full | `nx test @ptah-extension/canvas --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | PASS. exit 0; `Test Suites: 23 passed, 23 total`; `Tests: 255 passed, 255 total`. Log `%TEMP%\629-check-r9f-full.log` |
| 2 | r9f-tc | `nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache` | PASS. exit 0; `Successfully ran target typecheck`. Log `%TEMP%\629-check-r9f-tc.log` |
| 3 | r9f-lint | `nx lint @ptah-extension/canvas --parallel=1 --skip-nx-cache` | **FAIL**. exit 1; `26 problems (9 errors, 17 warnings)`. Log `%TEMP%\629-check-r9f-lint.log` |
| 4 | r9f-named-json | `jest -c libs/frontend/canvas/jest.config.ts .../canvas-detail-transcript.component.spec.ts --coverage=false --maxWorkers=2 --json --outputFile=%TEMP%\629-r9f-named.json` | PASS. 8/8 tests; the named case passes (see below) |

There was also a `r9f-named` run with `--verbose`. The project's Jest reporter config does not print the test
tree, so the JSON run above is the evidence.

### Lint errors (blocking): all 9 are in R9f code

File: `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.spec.ts` (none of these is in the HEAD version)

- `:4:26` `@angular-eslint/component-selector`: the `markdown` stub selector inside `jest.mock('ngx-markdown')`.
  The repo convention is a scoped `// eslint-disable-next-line @angular-eslint/component-selector` on the
  selector line. Examples: `libs/frontend/chat/src/lib/settings/settings.component.spec.ts:14`,
  `libs/frontend/markdown/src/lib/markdown-block.component.spec.ts:13`. The selector has to stay `markdown`,
  so this suppression follows the convention rather than hiding a defect.
- `:13-20` `@nx/enforce-module-boundaries` (8 errors): relative imports `../../../../chat/src/lib/...` reach into
  the internals of the chat lib.
  - Three are on the public API of `@ptah-extension/chat`, so the fix is to import them from there:
    `ActionBannerService`, `ChatStore` (both through `export * from './lib/services'`, `chat/src/index.ts:15`)
    and `ChangeSetActionsService` (`chat/src/index.ts:25`).
  - Five are not public: `SessionHistoryReplayer`, `HistoryPagingService`, `DisplayDockState`,
    `DisplayDockComponent`, `AgentMonitorPanelComponent`. The chat lib is not an R9f project (decision 93) and
    must not be widened in this batch. The spec has to reach them without importing the class. Examples: query
    `ptah-display-dock` / the agent monitor by CSS selector and read `componentInstance`; read the dock state
    through a public ChatView member or the rendered DOM; stub the two history services through public
    providers or drop the dependency. Disabling `@nx/enforce-module-boundaries` is not acceptable.

### Lint warnings (non-blocking, 17)

- 9 are in files outside R9f (`canvas-layout-persistence.service.spec.ts`, `canvas-focus-header.component.spec.ts`,
  `canvas-rail.component.spec.ts`) and were there before this batch.
- 3 in `canvas-lane-tabs.component.spec.ts:10-12` (`any`) were already at HEAD.
- 5 in `canvas-lane-view.component.spec.ts:35-38,48` (`any`): 4 were at HEAD; `:48 tabRecord = signal<any>` is
  new to R9f. It is a warning only, recorded as m4 below.

## rg: `HIDE_AGENT_SIDEBAR` (row 77 d)

- `HIDE_AGENT_SIDEBAR: true` in `libs/frontend/canvas`: **0 hits**. The token appears in canvas only in the
  transcript spec: an import at `:11` and `expect(injector.get(HIDE_AGENT_SIDEBAR, null)).toBeNull()` at
  `:116` and `:166`.
- Other places across libs/apps that provide it as true: `libs/frontend/tribunal-panel/src/lib/components/conductor-tile.component.ts:221`
  `{ provide: HIDE_AGENT_SIDEBAR, useValue: true }`. This one is already known and out of scope.
- Other references are not providers set to true: the token definition in `chat/.../session-context.token.ts:20`,
  the re-export in `chat/.../services/index.ts:101`, the readers in `chat-view.component.ts:245,276`, and the
  spec-parameterised `chat-view.dock.spec.ts:374` plus the null assertion in `chat-transcript.display.spec.ts:849`.

## Named case evidence (row 77 b)

From the Jest JSON (`%TEMP%\629-r9f-named.json`) for `canvas-detail-transcript.component.spec.ts`:

```
passed  CanvasDetailTranscriptComponent visibility fenced display opens and updates in place in Rail host
passed  CanvasDetailTranscriptComponent visibility Rail tile click selects sub lane through the real child injector without mounting the single view
passed  ... (6 more, all passed; 8/8)
```

The same spec also passed inside the full run (255/255). Caveat from code-logic-review-R9f-fix.md (S2): the
surfaces are fed through the store and no fenced markdown is parsed, so the case name claims more than the
test checks. Decision 93 accepts this.

## Recorded, not fixed (carry to the PR description)

| Id | Source | Item |
| --- | --- | --- |
| M3 | review R9f | No "agent not available" notice for a Rail tile or lane key whose agent cannot be resolved. `selectLaneFor` stores the stale key and the lane quietly falls back to the orchestrator. |
| M4 | review R9f | The live lane does not pass `[isStreaming]` or `[ptahUi]` to `ptah-execution-node`, so `ptah-ui` blocks in agent output get no host context (row 112 `$agents`/`$usage` inside the lane is unconfirmed). |
| M6 | review R9f | A workspace switch (`canvas-rail-board.component.ts:51` `@if (visible())`) tears down the ChatView and its `DisplayDockState`. Do not claim persistence across workspaces. |
| m1 | review R9f | The Back button sits before the lane content, and the CLI branch's `h-full` overflows by the button height. |
| m2 | review R9f | During the 180 ms fade, `position: fixed` descendants (dock overlay) are positioned against the transformed wrapper. |
| m3 | review R9f | NG0956 from tracking on a keyed block array literal. The full run shows 10 NG0956 console warnings. Track `laneKey()` directly. |
| m4 | this report | New lint warning `canvas-lane-view.component.spec.ts:48` `signal<any>`. |
| N4 | review R9f-fix | Escape closes the lane on any Escape inside the lane that no widget handles (for example a popover without `preventDefault`). The single view behaves the same way. |
| S2 caveat | review R9f-fix | The named display case feeds surfaces through the store rather than parsing a fence. The fence-to-surface path is covered by the chat lib. |
| S5g caveat | review R9f-fix | The test tile hard-codes `'sub:tool'`, so the real `SubagentTile` key mapping (`subagent-tile.component.ts:96-99`) is not exercised. |
| S5e caveat | review R9f-fix | The `agentTileMode() === false` assertion is weak because that is the default. Other assertions in the case carry it. |
| M5 residual | review R9f-fix | A failed Stop from the Rail lane is still an unobserved rejection. It is now owned by the chat bubble `onStopClick` (`inline-agent-bubble.component.ts:1090-1100`), outside R9f. |
| Pending | orchestrator | Findings of `code-logic-review-R9f-correction.md` (not on disk when this report was written). |

Note: `lane-R9f-correction-report.md` is not valid UTF-8 (Windows-1252 dashes and quotes). It is a task-folder
document only, with no effect on the code.

## Commit command for the orchestrator (only after the lint fix passes LINT(canvas) and the pending review)

Run from W in the foreground:

```bash
git add \
  libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts \
  libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.spec.ts \
  libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts \
  libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.spec.ts \
  libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts \
  libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.spec.ts \
  libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.ts \
  libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.spec.ts \
  libs/frontend/canvas/src/lib/canvas-session-overrides.ts \
  libs/frontend/canvas/src/lib/canvas-session-overrides.spec.ts
git commit -F - <<'EOF'
feat(canvas): batch R9f - persistent Rail transcript, dock, live lane

Restore the display dock in the focused Rail session by dropping
HIDE_AGENT_SIDEBAR from the Rail transcript host (decision 77).
Provide Rail SESSION_CARD_ACTIONS so tile clicks select sub: and bg:
lanes. Keep one ChatView and its draft across Open and Back, and
freeze the covered transcript through SESSION_VISIBLE and
SURFACE_ACTIVE.

Show the full lane as the real execution node in full mode, with the
inline bubble as the single owner of Stop and permission. Move Back
focus only for openings from inside the lane view. Migrate a
backgrounded sub: lane key to its bg: tab instead of resetting it
to the orchestrator (decision 98).

Recorded, not fixed: M3, M4, M6, m1-m4, N4 (see
mode2-h2-report.md).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
```

Message check: type `feat` and scope `canvas` are both in `.commitlintrc.json`. The subject is 69 chars and
starts lower-case with no full stop. The longest body line is 68 chars (at most 72).
