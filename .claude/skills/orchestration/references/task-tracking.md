# Task Tracking

Task IDs, the `task.md` carrier, the task folder, the generated registry, and continuation. This
file is the one home for task-ID allocation; other skills link here.

---

## Task ID

`TASK_YYYY_NNN_xxxx` — year, a sequence number zero-padded to at least three digits, and four random
lowercase hex characters (`TASK_2026_110_a1b2`). Older folders without the suffix stay valid.

The **folder name is the canonical ID**. An `id:` field in `task.md` that disagrees is a warning;
never rename a folder to "fix" it.

## New task

1. **Prefer the `tasks:create` RPC** where it is available — it reserves atomically and never
   overwrites.
2. **Allocating by hand**: scan `.ptah/specs` on `origin/main` (`git fetch`, then `git ls-tree`),
   every path from `git worktree list`, and the local folder. Take the highest `NNN` for the current
   year, add 1, zero-pad, append `_` + four random lowercase hex characters.
3. **Reserve** with an exclusive, fail-if-exists `mkdir` (`fs.mkdirSync(dir)` without `recursive`,
   not `mkdir -p`). The folder creation is the lock. On `EEXIST`, re-scan and retry with a fresh
   suffix; give up with an error rather than overwrite.
4. **Write `task.md` first**, as an exclusive create that fails if the file exists.
5. **Write `context.md`** from the template below.

Never derive the ID from `registry.md` — it is generated and can be stale.

A task folder the Tribunal UI already created (`Spec folder: … already created`) is used as given;
skip allocation.

---

## `task.md` — the carrier

A folder without a valid `task.md` is excluded from the board, the registry and spec harvesting.
Only the frontmatter is machine-read; the body is free markdown.

```markdown
---
id: TASK_YYYY_NNN_xxxx
status: in_progress
type: FEATURE
title: Short imperative title
description: >-
  One-line card summary. ALWAYS this block-scalar form.
depends_on: []
created: 2026-07-14T10:00:00.000Z
updated: 2026-07-14T10:00:00.000Z
---

## Description

Task description shown in the card detail.
```

| Field | Required | Rule |
| --- | --- | --- |
| `status` | yes | `backlog` \| `in_progress` \| `in_review` \| `blocked` \| `done` \| `cancelled`. Invalid ⇒ folder excluded |
| `title` | yes | Non-empty. Use a `>-` block scalar when it contains a colon |
| `id` | recommended | Folder name wins on mismatch |
| `type` | optional | `FEATURE` \| `BUGFIX` \| `REFACTORING` \| `DOCUMENTATION` \| `RESEARCH` \| `DEVOPS` \| `SAAS_INIT` \| `CREATIVE` |
| `description` | optional | **Always a `>-` block scalar** |
| `depends_on` | optional | Array of task IDs |
| `executor` | optional | Lane hint |
| `assignee`, `claim` | reserved | |
| `created`, `updated` | optional | ISO 8601; `updated` refreshes on status change |

**Why the block scalar**: a plain YAML scalar ends at the first colon-space, so a description that
quotes code (`a ? b : c`, `{"field": null}`) makes the whole frontmatter unparseable and the task
disappears from the board. A `>-` block survives colons, braces, quotes and apostrophes unescaped.

**Changing status**: `Edit` exactly the `status:` line. Never rewrite the carrier with `Write`, and
never track status in any other file.

## `context.md` template

```markdown
# Task Context - TASK_[ID]

## User Request
[Exact user request text]

## Task Type
[FEATURE | BUGFIX | REFACTORING | DOCUMENTATION | RESEARCH | DEVOPS | SAAS_INIT | CREATIVE]

## Complexity
[Simple | Medium | Complex]

## Strategy
[Strategy and depth]

## CLI Lanes
[Gate 0.1 outcome — see lane-assignment.md]

## Conversation Summary
[Key decisions and clarifications]
```

---

## Folder layout

```
.ptah/specs/
  registry.md                      GENERATED — never hand-edit
  TASK_[ID]/
    task.md                        carrier (first)
    context.md                     user intent, strategy, lane roster
    task-description.md            project-manager
    research-report.md             researcher-expert
    parity-inventory.md            project-manager (no PM: software-architect, inventory-only; see SKILL.md)
    design-spec.md                 ui-ux-designer
    prototype/                     ui-ux-designer (README.md, screenshots/) — Gate 1.7
    implementation-plan.md         software-architect
    task-description-review.md     document reviews (other execution side than the author);
    design-spec-review.md          each records author, reviewer, revision, rounds, verdict
    implementation-plan-review.md
    batches.md                     team-leader (former name tasks.md is still read)
    test-report.md                 senior-tester
    code-style-review.md           code-style-reviewer
    code-logic-review.md           code-logic-reviewer
    visual-review.md               visual-reviewer
    screenshots/                   visual-reviewer evidence
    future-enhancements.md         modernization-detector
```

`registry.md` is derived from each folder's `task.md` and carries a `GENERATED — DO NOT HAND-EDIT`
header. If it disagrees with a carrier, the carrier is right; regenerate.

---

## Continuation

Read `task.md` for status and `Glob` the folder. First check the document reviews and user gates the
selected flow requires, in order (1, 1.7, 2), and resume the earliest unfinished one — a review or
approval applies only to the artifact revision it names, and a document-review file never matches
the QA row. Before the next phase, complete any required inventory and design steps in
[SKILL.md](../SKILL.md#task-folder). Otherwise the furthest row that matches decides:

| Present | Next action |
| --- | --- |
| no `task.md` | Stop — invalid folder; create the carrier first |
| `task.md` / `context.md` only | Follow the strategy in `context.md`: BUGFIX → researcher-expert if research is planned, otherwise team-leader Mode 1 (plan-free); REFACTORING → software-architect; other types → their recorded first phase. Complete required inventory/design before implementation planning or decomposition. |
| `task-description.md` | Resume document review and Gate 1 for the current revision; continue only after recorded user approval |
| `research-report.md` (no later artifact) | Follow the strategy in `context.md`: BUGFIX → team-leader Mode 1 (plan-free); FEATURE → software-architect; other types → their recorded next phase. Complete required inventory/design first. |
| `parity-inventory.md` (no later artifact) | Run any planned research first, then resume required designer → prototype → document review → Gate 1.7, then the next phase recorded in `context.md`; without a design phase, continue the recorded flow (BUGFIX → team-leader Mode 1, plan-free). |
| `design-spec.md` + `prototype/` | Resume document review and Gate 1.7 for the current revision; after approval, select the next phase from the task type/strategy recorded in `context.md` (CREATIVE → technical-content-writer; BUGFIX → team-leader Mode 1; flows with architecture → software-architect) |
| `implementation-plan.md` | Resume document review and Gate 2 for the current revision; then team-leader Mode 1 |
| `batches.md`, a batch not COMPLETE | team-leader Mode 2 |
| `batches.md`, every batch COMPLETE | team-leader Mode 3, then Gate 3 |
| QA reports (`test-report.md`, `code-style-review.md`, `code-logic-review.md`, `visual-review.md`) | After the document gates and batch work: continue the chosen QA, or finish |
| `future-enhancements.md` | Workflow already complete |

## Status vocabularies

Word tokens only, no symbols.

- **Task status** (`task.md`): the six values above.
- **Batch and task status** (`batches.md`, written by team-leader): `PENDING`, `IN_PROGRESS`,
  `IMPLEMENTED`, `COMPLETE`, `FAILED`. Example heading: `## Batch 1: Backend — COMPLETE`.

Every path given to an agent is absolute.
