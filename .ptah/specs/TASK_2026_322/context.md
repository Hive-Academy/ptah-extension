# Context

## What the user saw

A brand-new project was opened in the Electron app. The Thoth → Skills tab
reported **36 pending** candidates, all dated `2026-08-18`, all describing
Tribunal Relay workflows from a different repository. Nothing in that project
had produced a single session yet.

## What is actually happening

The candidate pool is global by construction, in three steps:

1. There is one database for every workspace — `~/.ptah/state/ptah.sqlite`.
2. `skill_candidates` has no workspace column. The original schema is
   `libs/backend/persistence-sqlite/src/lib/migrations/0003_skills.ts:11-26`;
   the four later migrations that touch the table (`0011` `pinned`, `0026`
   `residency`, `0033` the eleven judge columns, `0036` the seven gate columns)
   added none.
3. The read path has no filter, and the RPC forwards it unchanged.

Origin is not entirely unrecorded — `SkillSynthesisService.analyzeSession`
hashes the workspace root into a 16-character `contextId` and writes it on the
candidate's first invocation row. But it is a sha256, so it cannot be turned
back into a path, and its only consumer is `countDistinctContexts`, which
counts how many DIFFERENT projects a skill has been used in. That is a
generality signal — the opposite of a scope filter.

## Why scoping the candidate list is right and scoping everything is wrong

A **candidate** is unreviewed work. It came from one session, in one project,
and the person who has to judge it is the person working in that project. A
review queue that mixes projects is asking someone to adjudicate work they have
no context for.

A **promoted skill** is the library. It is written to `~/.ptah/skills/<slug>/`
and propagated by the harness reconciler into every workspace's harness
directories. Cross-project reuse is the entire point, and
`countDistinctContexts` exists to reward it. Clustering, dedup, the residency
budget and the phase-3 gates all read the promoted set deliberately across
projects.

So exactly one read is scoped: the one that backs the Skills tab list. Every
other `listByStatus` caller keeps the unscoped overload it has today.

## The three-valued `workspace_root`

Migration `0040` follows the convention `skill_session_verdicts` already
documents in `skill-candidate.store.ts:898-917`:

- a **real path** — this candidate came from that workspace;
- **`''`** — deliberately cross-project (never written by the candidate path;
  reserved so the column means the same thing it means in
  `skill_synthesis_queue`);
- **`NULL`** — unknown. Every row predating this migration that the backfill
  could not resolve.

A scoped read **includes `NULL`**, exactly as `getWinRates` does. Excluding it
would make every pre-migration candidate permanently invisible in every
workspace, which trades a display bug for silent data loss.

## The backfill

`skill_synthesis_queue` carries both `workspace_root` (NOT NULL, `''` default)
and `candidate_id` (written by the drain when a stage completes), so the rows
whose queue entry produced them can be resolved. Rows older than the queue
(migration `0032`), or whose queue row was reaped by `0039`, stay `NULL` and are
shown in every workspace — honest, and the reason the scope toggle exists.

## Scope of the change

- `0040_skill_candidate_workspace_root` + registration + spec
- `SkillCandidateStore`: raw row field, INSERT column, `toCandidateRow`
  mapping, `listByStatus(status, workspaceRoot?)`
- `NewCandidateInput.workspaceRoot`, `SkillCandidateRow.workspaceRoot`
- `SkillSynthesisService` passes the root it already holds
- `skillSynthesis:listCandidates` gains `scope?: 'workspace' | 'all'`
  (default `'workspace'`); the summary DTO gains `workspaceRoot`
- Skills tab: a scope toggle beside the status filter, defaulting to the
  current workspace, and an origin line on each card when showing all projects

Out of scope: any change to promotion, clustering, dedup, residency, the gates,
or the harness propagation of promoted skills.
