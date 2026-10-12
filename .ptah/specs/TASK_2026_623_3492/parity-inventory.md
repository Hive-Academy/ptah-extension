# Parity Inventory - TASK_2026_623_3492

Revision 2 (2026-10-09). This revision folds in the user decisions in decisions.md #5, #6, #8, #9 and #10:

- The Electron change-set card placement is approved for replacement.
- The tests-row move is approved.
- The footer badges stay.
- The previews are polished in both webviews.
- Chips and cards are collapsible and responsive (task-description.md R9).

Surfaces replaced or rebuilt:

1. **Turn summary.**
   - The 610 PR A tests row, mounted at `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html:107-118`.
   - The TASK_2026_576 change-set card, mounted at
     `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html:69-104`.
   - The message footer token, cost and duration badges, at `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html:135-183`.
2. **Command preview (Bash) and file preview (Read, Write, Edit).** These are the tool-call item and the chat-ui
   tool-execution molecules.

Paths below are relative to the worktree root. Abbreviations:

- `CSC` = `libs/frontend/chat-ui/src/lib/molecules/change-set/change-set-card.component.ts`
- `TTR` = `libs/frontend/chat-ui/src/lib/molecules/turn-recap/turn-tests-row.component.ts`
- `TE` = `libs/frontend/chat-ui/src/lib/molecules/tool-execution/`
- "Summary spec" = the new R6 panel-summary spec. The architect names it, and its cases are listed per row.

Decision rules:

- **keep**: the capability stays where it is and may be restyled.
- **move**: the same capability in a new place.
- **move (user-approved #N)**: a placement change the user approved in decisions.md #N.
- **remove-proposed**: the old placement is withdrawn, pending user approval. Every one is listed under Proposed
  Removals. After revision 2, no item is in this state.

All Electron-only placement changes leave VS Code unchanged (decisions.md #4). Section 4 is the exception: it applies
to both webviews (decisions.md #8).

Every chip and card in the new locations (R6 cards and chip, R7 preview cards) must also meet task-description.md R9:
collapsible, and no overflow at `chat-narrow`, `chat-wide`, `panel-narrow` and `panel-wide`.

## 1. Tests row (610 PR A)

| Capability | Where today (file:line) | Backing RPC / API | Decision | New location | Test that proves it |
| ---------- | ----------------------- | ----------------- | -------- | ------------ | ------------------- |
| Test-command detection (normative 610 matcher) | `libs/shared/src/lib/utils/test-command-matcher.ts:197,244` | none; execution tree `toolInput.command` | keep | unchanged (shared util) | `test-command-matcher.spec.ts` |
| Outcome per run (passed, failed, running, unknown; Jest and Nx output parsing; per-project split; ≤5 failure lines) | `libs/shared/src/lib/utils/turn-tests.utils.ts:25,51,70,117,156` | none; stored `ExecutionNode` tree | keep | unchanged; feeds the Tests card and `$tests` | `turn-tests.utils.spec.ts` |
| Renders only when at least one test run exists | `TTR:75`; transcript `@defer (when tests.runs.length > 0)` `chat-transcript.component.html:108` | none | move | Tests card omitted when empty (R6.4) | Summary spec: "turn with no test command has no Tests card" |
| Header summary label ("2 passed, 1 failed", "N running in background", "unknown") | `TTR:96-102,210-224` | none | move | Tests card value | Summary spec: label cases ported from `turn-tests-row.component.spec.ts` |
| "(incomplete)" marker for aborted or errored turns | `TTR:103-109`; `incomplete` from `transcript-turns.ts:104` | none | move | Tests card and summary header (R6.3) | Summary spec: aborted-turn fixture |
| Expand and collapse with `aria-expanded` / `aria-controls`, expanded by default | `TTR:81-110,195` | none | move | Tests card expansion (R6.1; default state per Gate 1.7 design) | Summary spec: toggle and ARIA; axe fixture |
| Per-run outcome icon with an accessible label | `TTR:119-148` | none | move | Tests card run rows | Summary spec + axe |
| Run label: Nx project or command | `TTR:149-159` | none | move | Tests card run rows | Summary spec |
| Full command in a `<details>` | `TTR:161-171` | none | move | Tests card run rows | Summary spec |
| Failure lines per run | `TTR:172-178` | none | move | Tests card run rows | Summary spec |
| Electron-only computation of tests anchors | `chat-transcript.component.ts:589-597` (`isElectron` at L590) | `VSCodeService.isElectron` | move | the summary's Electron gating | Summary spec: VS Code host renders no summary |
| In-chat placement below the turn-ending message (Electron; VS Code renders no row today and is unchanged) | `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html:107-118`; Electron gate `chat-transcript.component.ts:589-597` | none | move (user-approved #10) | panel Tests card, plus the test outcome in the R6 chip | `chat-transcript` spec: no `chat-turn-tests` element in Electron, chip text has the outcome, VS Code output unchanged |
| Lazy chunk `@ptah-extension/chat-ui/turn-recap` | `libs/frontend/chat-ui/src/turn-recap.ts:15` | none | move | lazy summary chunk (NFR lazy loading) | 5.1 initial-chunk report |

## 2. Change-set card (TASK_2026_576)

Data for every row comes from `libs/frontend/chat/src/lib/services/change-set/change-set.store.ts`:

- RPC `git:turnChangeSets` (L410-412)
- push `git:turnChangeSet`
- RPC `git:info` for reconciliation (L637-639)

Actions go through `libs/frontend/chat/src/lib/services/change-set/change-set-actions.service.ts`:

- Electron: `@ptah-extension/git-ui` `ReviewNavigationService` (L69-125).
- VS Code: `command:execute` with `ptah.review.*` (L36-41, L154).

These data and action paths are **keep** in both runtimes. The rows below cover the presentation.

| Capability | Where today (file:line) | Backing RPC / API | Decision | New location | Test that proves it |
| ---------- | ----------------------- | ----------------- | -------- | ------------ | ------------------- |
| "N files changed" header | `CSC:159-163,503` | `git:turnChangeSets` / `git:turnChangeSet` | move (Electron) / keep (VS Code) | Files card value; R6 chip text | Summary spec; `change-set-card.component.spec.ts` (VS Code) |
| Line totals +A −D, shown only when non-zero | `CSC:170-181,486` | same | move (Electron) / keep (VS Code) | Lines card; chip text | Summary spec |
| "counts unavailable" | `CSC:164-169` | `TurnChangeSet.countsUnavailable` | move / keep | Files and Lines cards (R6.3) | Summary spec: `countsUnavailable` fixture |
| Conflicted count badge, and per-row "Conflicted" / `U` status | `CSC:183-189,228-232,251-262` | `git:info` reconciliation marks | move / keep | Files card expansion | Summary spec: conflicted fixture |
| Reconciled summary "No longer changes HEAD", and the collapsible reconciled group | `CSC:190-196,295-347` | `git:info` | move / keep | Files card expansion | Summary spec: reconciled fixture |
| Review action ("Review" on Electron, "Review all" on VS Code) | `CSC:198-205,508` | `ChangeSetActionsService.review` (L69) | move / keep | Files card action (R6.8) | Summary spec: review invokes the service; `change-set-actions.service.spec.ts` |
| Collapse and expand; auto-expand when ≤ 5 files; forced open on conflict; the user's choice wins | `CSC:140-147,47,457` | none | move / keep | Files card expansion (default per Gate 1.7 design; forced open on conflict kept) | Summary spec: conflict forces expansion |
| `baselineMissing` note | `CSC:210-216` | `TurnChangeSet.baselineMissing` | move / keep | Files card (R6.3) | Summary spec |
| File row opens the file in review | `CSC:221-269`; handler `chat-transcript.component.ts:658` | `ChangeSetActionsService.openFile` (L97-110) | move / keep | Files card rows | Summary spec: row click invokes `openFile(changeSet, path)` |
| Status letter badge (`ptah-file-status-badge`) and rename `origPath` | `CSC:228-250` | `TurnChangeSet.files[].status`, `.origPath` | move / keep | Files card rows | Summary spec: rename fixture |
| Per-file counts: binary → "binary", null → "?", "+0 −0" only when both are 0 | `CSC:59-73` | same | move / keep | Files card rows (reuse the same formatter) | Summary spec, ported from `change-set-card.component.spec.ts` |
| Paging: 50 rows per page, then "Show more" | `CSC:50,272-283` | none | move / keep | Files card rows | Summary spec: 51-file fixture |
| `truncatedCount` "N more files not listed" | `CSC:284-290` | `TurnChangeSet.truncatedCount` | move / keep | Files card (R6.3) | Summary spec |
| "Open Source Control" (VS Code only) | `CSC:357-367` | `ChangeSetActionsService.openScm` → `ptah.review.openScm` | keep (VS Code only) | unchanged | `change-set-card.component.spec.ts` |
| Narrow layout container query (≤ 240 px) | `CSC:377-400` | none | move / keep | Files card is container-responsive (R3.5) | Summary spec at a 300 px panel width |
| Accent border from change state | `CSC:87` | none | move / keep | summary card tone (per Gate 1.7 design) | visual review |
| Row titles ("Show in review", "Resolve"; VS Code diff and merge titles) | `CSC:533` | none | move / keep | Files card row accessible names | Summary spec + axe |
| Action error line (`role="alert"`) | `chat-transcript.component.html:84-100` | action rejection | move / keep | Files card (R6.8) | Summary spec: rejected action shows the error |
| Lazy entry `@ptah-extension/chat-ui/change-set-card` with `@defer (when …)` | `libs/frontend/chat-ui/src/change-set-card.ts:29-32`; `chat-transcript.component.html:70` | none | keep (VS Code) / move (Electron, lazy summary chunk) | lazy summary chunk | 5.1 initial-chunk report |
| In-chat card placement below the turn-ending message (Electron) | `chat-transcript.component.html:69-104` | none | move (user-approved #5; Electron only, VS Code keeps the card) | R6 chip in the same place; card capabilities in the Files and Lines cards | `chat-transcript.change-set.spec.ts` updated for the Electron chip; VS Code case unchanged |
| Anchor computation (which message ends the turn) | `chat-transcript.component.ts:569-578`; `transcript-change-set-anchors.ts` | none | keep | also anchors the R6 chip | `transcript-change-set-anchors.spec.ts` |

## 3. Message footer badges

| Capability | Where today (file:line) | Backing RPC / API | Decision | New location | Test that proves it |
| ---------- | ----------------------- | ----------------- | -------- | ------------ | ------------------- |
| Token badge (input + output) | `message-bubble.component.html:172-176` | `ExecutionChatMessage.tokens` | keep (user decision #6) | unchanged; turn totals also in the Tokens card | `message-bubble.component.spec.ts` |
| Cost badge; null or non-finite → "cost unavailable"; a real 0 is kept | `message-bubble.component.html:177-179`; `libs/frontend/chat-ui/src/lib/atoms/cost-badge.component.ts:43-50,70-75` | `ExecutionChatMessage.cost` | keep (user decision #6) | unchanged; the same rule in the Cost card | `cost-badge.component.spec.ts`; Summary spec: null cost → "unavailable" |
| Duration badge | `message-bubble.component.html:180-182`; `duration-badge.component.ts:25` | `ExecutionChatMessage.duration` | keep (user decision #6) | unchanged; the Duration card | `duration-badge.component.spec.ts` |
| Collapsed-bubble cost and duration badges | `message-bubble.component.html:135-152` | same | keep | unchanged | `message-bubble.component.spec.ts` |
| Badge atoms reused by agent bubbles, session stats and the tool header | `inline-agent-bubble.component.ts:524-532`; `session-stats-summary.component.html`; `TE/tool-call-header.component.ts:148-150` | — | keep | unchanged | existing specs of those components |

## 4. Command preview and file preview

This section applies to both the Electron and the VS Code webviews (decisions.md #8). Each test listed runs for both
host configurations where the component branches on the host.

| Capability | Where today (file:line) | Backing RPC / API | Decision | New location | Test that proves it |
| ---------- | ----------------------- | ----------------- | -------- | ------------ | ------------------- |
| Tool row collapsed by default | `libs/frontend/chat/src/lib/components/molecules/tool-execution/tool-call-item.component.ts:116` | none | keep | same | `tool-call-item.component.spec.ts` |
| Auto-expand when a permission request arrives; embedded permission card | `tool-call-item.component.ts:86-97,137-143` | permission request flow (`permissionResponded` output) | keep | same | `tool-call-item.component.spec.ts` |
| Gold styling for `mcp__ptah` tools; "Ptah Superpower" and tool-name badges | `tool-call-item.component.ts:123-130`; `TE/tool-call-header.component.ts:80-95` | none | keep | restyled | header spec (new, R7.1) |
| Toggle button with `aria-expanded` | `TE/tool-call-header.component.ts:65-70` | none | keep | same | header spec (new) |
| Clickable file path (short path, full path in title) for Read, Write and Edit | `TE/tool-call-header.component.ts:97-101,199-240`; `libs/frontend/chat-ui/src/lib/atoms/file-path-link.component.ts:63-85` | `FILE_LINK_OPENER` → `file-link-router.service.ts` (Electron dock viewer L96; VS Code RPC `file:open` L148) | keep | file preview header (R7.5) | `file-path-link.component.spec.ts`; header spec |
| Bash description, or the command truncated to 40 characters, with the full command in the title | `libs/frontend/chat-ui/src/lib/utils/tool-target.utils.ts:47-54`; header L102-108 | none | keep (plus the full command on expand, R7.2) | command preview | header spec |
| Streaming description ("Running …", "Reading …") | `TE/tool-call-header.component.ts:136-145,280-310` | none | keep | same | header spec |
| Parse-error warning | `TE/tool-call-header.component.ts:112-120` | none | keep | same | header spec |
| Status icons (complete, error, streaming) | `TE/tool-call-header.component.ts:123-145` | `ExecutionNode.status` | keep (plus text and accessible names, R7.3) | same | header spec + axe |
| Duration badge per tool call | `TE/tool-call-header.component.ts:148-150` | `ExecutionNode.duration` | keep | same | header spec |
| Input section: collapsible, hidden for trivial inputs (TodoWrite, Edit, Read with only `file_path`) | `TE/tool-input-display.component.ts:44-55,220-239` | none | keep | same | `tool-input-display.component.spec.ts` |
| Parameter values truncated to 60 characters | `TE/tool-input-display.component.ts:325-341` | none | keep for non-command, non-content parameters (R7.2 and R7.7 show the full command and Write content) | same | `tool-input-display.component.spec.ts` |
| Write `content` over 200 characters: expandable highlighted code | `TE/tool-input-display.component.ts:262-297` | none | keep | Write preview (R7.7) | `tool-input-display.component.spec.ts` |
| Input retention (truncation) notice | `TE/tool-input-display.component.ts:104-110,150-180` | `ExecutionNode.retention` | keep | same | `tool-input-display.component.spec.ts` |
| Output routing (TodoWrite → todo list, Edit → diff, other → code output) | `TE/tool-output-display.component.ts:54-63` | none | keep | same | `tool-output-display.component.spec.ts` |
| Output retention notice and error alert | `TE/tool-output-display.component.ts:72-81,100-116` | `ExecutionNode.retention`, `.error` | keep | same | `tool-output-display.component.spec.ts` |
| Code output: height-limited scroll (`max-h-48`) | `TE/code-output.component.ts:44-51` | none | keep (plus expand, R7.4) | same | `code-output.component.spec.ts` |
| ANSI stripping, system-reminder stripping, Read `N→` prefix stripping | `TE/code-output.component.ts:174-177,194-202` | none | keep | same | `code-output.component.spec.ts` |
| Language detection (extension, `bash` for Bash, JSON sniffing) | `TE/code-output.component.ts:126-167`; `TE/code-fence.ts:1-8` | none | keep | same; the language label (R7.5) | `code-output.component.spec.ts`; `code-fence.spec.ts` |
| Edit diff header: path link and replacements badge | `TE/diff-display.component.ts:45-56` | `FILE_LINK_OPENER` | keep (plus +/− counts, R7.6) | same | `diff-display.component.spec.ts` |
| Edit diff body (old lines `-`, then new lines `+`), `max-h-64` | `TE/diff-display.component.ts:59-66,149-163` | none | keep (restyled with a gutter, R7.6) | same | `diff-display.component.spec.ts` |

## Proposed Removals

None pending. Every capability is kept or moved, and nothing is removed silently. The two placement changes that
revision 1 listed here are now user-approved moves:

- **Tests row in-chat placement (Electron)**
  (`libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html:107-118`).
  - Approved by decisions.md #10.
  - Every tests-row capability moves to the panel Tests card (section 1), and the R6 chip carries the test outcome.
  - VS Code renders no tests row today and stays unchanged.
- **Change-set card in-chat placement (Electron only)**
  (`libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html:69-104`).
  - Approved by decisions.md #5.
  - Every card capability moves to the Files and Lines cards (section 2). VS Code keeps the card.
- **Footer token, cost and duration badges:** they stay in both runtimes (decisions.md #6, section 3).
