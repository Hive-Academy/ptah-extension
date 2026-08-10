# Context — Directory rows produce a generic `unknown` error

## Origin

`TASK_2026_173` (Editor panel — git-diff correctness, measured performance, hunk stage/revert), Batch 9
follow-up filing, Task 9.2. This is `r3-triage.md` §"Follow-up findings" item 1, discovered during the
R-3 triage matrix (13 real-git failure-mode cases exercised in Electron, before Batch 2 merged) that A3
exists to surface. **Nothing was re-suppressed to avoid filing this** — discovering previously-invisible
git-read failures and either fixing or filing them is the entire point of A3.

## Finding (quoted from `r3-triage.md`)

> **Directory rows produce a generic `unknown` error rather than a directory-specific message.**
> Clicking an untracked directory row in Source Control (row 14 of the triage matrix) is technically
> clickable today and resolves to a correct, non-crashing, persistent error overlay — but the copy says
> "Git could not read this file" rather than something like "Cannot diff a directory." Low severity: no
> data-integrity risk, no crash, no misrendering as content. Filed as a UX polish follow-up, not a
> Batch 2 blocker — A3's actual requirement (never render an unreadable path as fabricated content) is
> already satisfied.

## Fix (either one, per the dispatch)

1. Hide the diff affordance entirely on `isDirectory` rows in `SourceControlFileComponent` (directory
   rows become non-clickable for diffing), **or**
2. Add a dedicated `is-a-directory` outcome to the `GitReadErrorCode` table (`libs/shared/src/lib/types/rpc/rpc-git.types.ts`) and map it to a directory-specific message on the frontend error-string table in `diff-view.component.ts`.

Either resolves this; the choice is a UX call (silently prevent vs. clearly explain), not filed here.

## Source

`TASK_2026_173/r3-triage.md` §"Follow-up findings" item 1; `TASK_2026_173/batch-9-dispatch.md` §3
(Task 9.2); `TASK_2026_173/tasks.md` Task 9.2, DoD item 9, task-description Out-of-Scope item 8.
