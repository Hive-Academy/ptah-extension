# Task Tracking Reference

This reference documents the task management system used by the orchestration workflow, including ID formats, the `task.md` frontmatter contract, folder structures, the generated registry, and continuation mode detection.

---

## Task ID Format

```
TASK_YYYY_NNN
```

| Component | Description                     | Example       |
| --------- | ------------------------------- | ------------- |
| `TASK_`   | Fixed prefix                    | TASK\_        |
| `YYYY`    | Year                            | 2026          |
| `_`       | Separator                       | \_            |
| `NNN`     | Sequential number (zero-padded) | 001, 042, 110 |

**Examples**: `TASK_2026_001`, `TASK_2026_042`, `TASK_2026_110`

The **folder name is the canonical id**. When the `id` field inside `task.md`
frontmatter disagrees with the folder name, the folder name wins (the mismatch
is surfaced as a non-fatal validation warning).

---

## `task.md` — the First Artifact (REQUIRED)

**Every task folder MUST contain a `task.md` as its FIRST artifact**, created
before any other document in the run. `task.md` is the system-owned carrier: a
small YAML frontmatter block plus a free markdown body. It is the single source
of truth for a task's status and metadata; the board, the registry, and spec
harvesting all read it.

A folder **without a valid `task.md` is EXCLUDED** from the index, the registry,
and the board — it is counted and logged, never inferred. There is **no legacy
backfill and no emoji-status parsing**.

### Frontmatter Contract

```markdown
---
id: TASK_2026_158
status: backlog # backlog | in_progress | in_review | blocked | done | cancelled
type: FEATURE # FEATURE | BUGFIX | REFACTORING | DOCUMENTATION | RESEARCH | DEVOPS | SAAS_INIT | CREATIVE
title: Short imperative title
description: One-line summary (optional; long form goes in the body)
assignee: # reserved
depends_on: [] # e.g. [TASK_2026_140, TASK_2026_155]
executor: # optional agent lane hint
claim: # reserved
created: 2026-07-14T10:00:00.000Z
updated: 2026-07-14T10:00:00.000Z
---

## Description

Free markdown body — rendered in the card detail. The frontmatter block above
is the only machine-read part; edit the body freely.
```

### Field Rules

| Field         | Required    | Notes                                                           |
| ------------- | ----------- | --------------------------------------------------------------- |
| `status`      | **Yes**     | Must be one of the six values below. Invalid ⇒ folder excluded. |
| `title`       | **Yes**     | Non-empty. Missing ⇒ folder excluded.                           |
| `id`          | Recommended | Folder name always wins on mismatch (warning only).             |
| `type`        | Optional    | Unknown value ⇒ warning, treated as unset.                      |
| `description` | Optional    | One-line card summary.                                          |
| `depends_on`  | Optional    | Array of task ids. Malformed ⇒ warning, treated as `[]`.        |
| `executor`    | Optional    | Agent lane hint.                                                |
| `assignee`    | Optional    | Reserved.                                                       |
| `claim`       | Optional    | Reserved.                                                       |
| `created`     | Optional    | ISO 8601. Unparseable ⇒ warning, treated as unset.              |
| `updated`     | Optional    | ISO 8601. Refreshed automatically on every status transition.   |

### Status Values (`task.md` frontmatter)

| Status        | Meaning                           |
| ------------- | --------------------------------- |
| `backlog`     | Not yet started                   |
| `in_progress` | Actively being worked             |
| `in_review`   | Implementation done, under review |
| `blocked`     | Waiting on an external dependency |
| `done`        | Completed                         |
| `cancelled`   | Abandoned                         |

### Changing Status

**Status transitions happen by editing the `task.md` frontmatter only** — set
`status` to the new value (and let `updated` refresh). Do not track status in any
other file, and do not hand-edit the registry to reflect a status change.

---

## Folder Structure

```
.ptah/specs/
  registry.md                    # GENERATED registry (derived — never hand-edit)
  TASK_[ID]/
    task.md                      # REQUIRED first artifact — frontmatter carrier
    context.md                   # User intent, conversation summary
    task-description.md          # Requirements (PM output)
    implementation-plan.md       # Architecture design (Architect output)
    tasks.md                     # Atomic task breakdown (Team-leader output)
    test-report.md               # Testing results (Tester output)
    code-style-review.md         # Style review (Code-style-reviewer output)
    code-logic-review.md         # Logic review (Code-logic-reviewer output)
    visual-review.md             # Visual review (Visual-reviewer output)
    screenshots/                 # Visual testing screenshots
      baseline.png               # Baseline screenshot
      mobile.png                 # Mobile viewport
      tablet.png                 # Tablet viewport
      desktop.png                # Desktop viewport
    future-enhancements.md       # Future work (Modernization-detector output)
    visual-design-specification.md # Visual design (UI/UX Designer output, optional)
```

---

## Registry Management

### The Registry is GENERATED

```
.ptah\specs\registry.md
```

`registry.md` is a **derived view generated from each folder's `task.md`
frontmatter** — it is NOT a hand-edited source of truth. Never hand-edit it; any
manual change is overwritten on the next regeneration. It carries a
`GENERATED — DO NOT HAND-EDIT` header and lists only folders that have a valid
`task.md`, followed by an excluded-folder count.

### Registry Format

```markdown
<!-- GENERATED — DO NOT HAND-EDIT. Derived from TASK_*/task.md frontmatter. -->

# Task Registry

| Task ID       | Status      | Type          | Title                 | Created    | Updated    |
| ------------- | ----------- | ------------- | --------------------- | ---------- | ---------- |
| TASK_2026_110 | in_progress | DOCUMENTATION | Skill conversion      | 2026-01-20 | 2026-01-21 |
| TASK_2026_108 | done        | FEATURE       | WebSocket integration | 2026-01-15 | 2026-01-16 |

_Excluded (no valid frontmatter): 85 folder(s)._
```

### Reading Task History

Read the registry to understand project task history and current statuses.
Because the registry is generated, treat the per-folder `task.md` frontmatter as
ground truth if the two ever appear to differ (regenerate to reconcile).

### Generating a New Task ID

The next id is derived from a **folder scan**, not from registry contents:

1. Scan all `TASK_YYYY_*` folder names (including excluded/legacy folders).
2. Find the highest `NNN` for the current year.
3. Increment by 1.
4. Zero-pad to three digits: `TASK_YYYY_NNN`.

**Example**: If the highest for the year is `TASK_2026_109`, next is `TASK_2026_110`.

Create the folder and write its `task.md` (with `status: backlog` or
`in_progress`) as the first artifact — the folder joins the board and the next
registry regeneration automatically.

---

## Document Templates

### task.md Template

Created FIRST during Phase 0 initialization (see the frontmatter contract above):

```markdown
---
id: TASK_[ID]
status: in_progress
type: FEATURE
title: [Short imperative title]
description: [One-line summary]
depends_on: []
created: [ISO date]
updated: [ISO date]
---

## Description

[Task description shown in the card detail]
```

### context.md Template

Created during Phase 0 initialization:

```markdown
# Task Context - TASK\_[ID]

## User Request

[Exact user request text]

## Task Type

[FEATURE | BUGFIX | REFACTORING | DOCUMENTATION | RESEARCH | DEVOPS | CREATIVE]

## Complexity Assessment

[Simple | Medium | Complex]

## Strategy Selected

[Strategy name from strategies.md]

## Conversation Summary

[Key decisions, clarifications, and context from conversation]

## Related Tasks

- [TASK_YYYY_NNN]: [relationship]

## Created

[ISO date]
```

### Document Ownership

| Document               | Created By             | Contains                          |
| ---------------------- | ---------------------- | --------------------------------- |
| task.md                | Orchestrator (Phase 0) | Frontmatter carrier (status/meta) |
| context.md             | Orchestrator (Phase 0) | User intent, task metadata        |
| task-description.md    | project-manager        | Requirements, acceptance criteria |
| implementation-plan.md | software-architect     | Architecture, file specifications |
| tasks.md               | team-leader (MODE 1)   | Batched atomic tasks              |
| test-report.md         | senior-tester          | Test results, coverage            |
| code-style-review.md   | code-style-reviewer    | Pattern compliance findings       |
| code-logic-review.md   | code-logic-reviewer    | Business logic findings           |
| visual-review.md       | visual-reviewer        | UI/UX visual testing results      |
| future-enhancements.md | modernization-detector | Future improvement opportunities  |

---

## Continuation Mode

### Detecting Continuation Request

```
/orchestrate TASK_2026_XXX    → Continuation mode
/orchestrate [description]    → New task mode
```

### Phase Detection

When continuing a task, read existing documents to determine current phase:

```bash
Glob(.ptah/specs/TASK_[ID]/*.md)
```

### Phase Detection Table

| Documents Present                | Phase Status           | Next Action                           |
| -------------------------------- | ---------------------- | ------------------------------------- |
| No task.md                       | **Invalid / excluded** | ERROR: task has no valid carrier      |
| task.md only                     | Initialized            | Invoke project-manager                |
| + context.md                     | Context captured       | Invoke project-manager                |
| + task-description.md            | PM done                | User validate OR next agent           |
| + visual-design-specification.md | Designer done          | Invoke software-architect             |
| + implementation-plan.md         | Architect done         | User validate OR team-leader MODE 1   |
| + tasks.md (all PENDING)         | Decomposition done     | team-leader MODE 2 (first assignment) |
| + tasks.md (has IN PROGRESS)     | Dev in progress        | team-leader MODE 2 (verify + next)    |
| + tasks.md (has IMPLEMENTED)     | Dev done, await verify | team-leader MODE 2 (verify + commit)  |
| + tasks.md (all COMPLETE)        | Dev complete           | team-leader MODE 3 OR QA choice       |
| + test-report.md                 | Tester complete        | Continue QA or complete               |
| + code-style-review.md           | Style reviewed         | Continue QA or complete               |
| + code-logic-review.md           | Logic reviewed         | Continue QA or complete               |
| + visual-review.md               | Visual reviewed        | Complete workflow                     |
| + future-enhancements.md         | All done               | Workflow already complete             |

### Continuation Logic

```
1. Parse TASK_ID from user input
2. Read task.md frontmatter for the current status
3. Glob task folder for existing documents
4. Match against phase detection table
5. Resume at detected phase
```

### Example Continuation

```
User: /orchestrate TASK_2026_108

Orchestrator:
1. Read .ptah/specs/TASK_2026_108/task.md → status: in_progress
2. Glob .ptah/specs/TASK_2026_108/*.md
3. Found: task.md, context.md, task-description.md, implementation-plan.md, tasks.md
4. Check tasks.md → has IN PROGRESS tasks
5. Detected phase: "Dev in progress"
6. Action: Invoke team-leader MODE 2 (verify + next)
```

---

## Task Status Values

There are two distinct status vocabularies. Both use **word tokens only — no emoji**.

### Task Status (`task.md` frontmatter — the source of truth)

See the six values under the frontmatter contract above
(`backlog | in_progress | in_review | blocked | done | cancelled`). This is what
the board, the registry, and spec harvesting read.

### Batch Status (in `tasks.md`)

`tasks.md` breaks a task into batches; each batch heading carries a **word-token**
status. No emoji — the harvester parses these tokens directly.

| Status      | Meaning                              |
| ----------- | ------------------------------------ |
| PENDING     | Not yet assigned                     |
| IN PROGRESS | Developer working                    |
| IMPLEMENTED | Code complete, awaiting verification |
| COMPLETE    | Verified and committed               |
| FAILED      | Verification failed                  |

**Example batch heading**: `## Batch 1: Backend — COMPLETE`

---

## File Path Conventions

**CRITICAL**: Always use absolute Windows paths with drive letters for all file operations.

```
Correct:  .ptah\specs\TASK_2026_110\task.md
Incorrect: .ptah/specs/TASK_2026_110/task.md
Incorrect: ./.ptah/specs/TASK_2026_110/task.md
```

---

## Integration with Other References

- **SKILL.md**: Phase 0 initialization creates task.md (first) then context.md
- **strategies.md**: Determines which documents are created for each workflow type
- **team-leader-modes.md**: MODE 1 creates tasks.md
- **agent-catalog.md**: Each agent outputs specific document(s)
- **checkpoints.md**: Validation points between document creation phases
