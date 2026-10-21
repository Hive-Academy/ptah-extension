# Code Logic Review, Round 3 (post-cap correction) - TASK_2026_662

Scope: only the S1, M3, M4, M5 regions. Static read; no checks run (lane reports test, typecheck and lint pass).

## Per-finding status

| Finding | Status | Evidence |
| --- | --- | --- |
| S1 root mismatch | FIXED | `skill-task-grade.store.ts:118` normalises the requested root. Both queries now filter only by `task_id` in SQL and then in TypeScript (`:140`, `:148-149`) with `workspace_root !== null && normalizeWorkspaceRoot(stored) === normalizedRoot`, so null roots never match. The old non-root conditions are all kept: registry EXISTS and source filter, session-link self-correlation (`s.workspace_root = e.workspace_root`, `s.session_id = e.session_id`, `s.task_id = ?`, uniqueness NOT EXISTS, `:128-139`), lane `role` non-empty, registry EXISTS and `executor_kind = 'subagent'` (`:143-148`). Grades and `removeAbsent` use the one normalised root (`spec-harvester.service.ts:150,177-183`; `removeAbsent` compares `workspace_root = ?` against it). The zero-attribution warn (`:154-157`) fires once per spec per harvest and logs only taskId and counts. |
| M3 write order | FIXED | `skills-synthesis-rpc.handlers.ts:658-671` writes the `skills.enhancement.*` key first, then the legacy key. A failure on the second write leaves the new key (the one the enhancer reads) updated. |
| M4 REJECT / NEEDS REVISION | FIXED, with a regression (N1) | `spec-extractor.ts:78-81,108` normalises `[\s-]+` to `_`, and `reject` and `needs_revision` are in the fail list. Spec cases at `spec-extractor.spec.ts:58-61`. |
| M5 last parseable verdict | FIXED, with a regression (N1) | `spec-extractor.ts:109-111` scans matches backward until one parses. Spec at `:62`. |

## New findings

### Blocking
None.

### Serious
None.

### Moderate

- **N1. The widened capture makes trailing prose on the verdict line unparseable.** `spec-extractor.ts:109` captures `[a-z_]+(?:[ -][a-z_]+)*`, which now consumes every following word on the line. `Recommendation: APPROVE with minor changes`, `Verdict: APPROVED and merged` and `Status: complete and verified` capture the whole phrase, normalise to something not in either list, and return null. Before, the first word was captured and the line parsed. The backward scan falls back to an earlier match, but a review with only that line yields no verdict, so the grade is silently skipped. This is the same silent-absence class as S1. Fix: capture the first token and optionally a second `needs`-style word, e.g. `([a-z_]+(?:[ -]revision)?)`, or try progressively shorter word prefixes. Add a spec for `APPROVE with minor changes`.
- **N2. The task-id-null branch lost its workspace pre-filter.** `skill-task-grade.store.ts:127-139`. The `e.task_id IS NULL AND EXISTS(session_task_links...)` branch previously narrowed by `e.workspace_root = ?`. It now evaluates every task-less event in all workspaces for each harvested spec. Results are correct but cost grows with the event table. The correlation is bounded by the `s.task_id = ?` link lookup, so this is a cost concern only.

### Minor

- **N3.** Grade rows already written under the pre-fix root form are not matched by `removeAbsent` (`:170`, exact `workspace_root = ?`). They remain stale until overwritten. This applies to existing databases only and is low impact.
- **N4.** Spec coverage (`skill-task-grade.store.spec.ts:43-69`) exercises the event path only. Neither the lane-record root filter nor a null stored root is asserted, though both are implemented correctly. The Windows drive-letter case is skipped off win32, and the trailing-separator case is cross-platform via `join` and `sep`.

## Verdict

Verdict: APPROVED
Score: 8/10. All four findings are fixed. N1 is a real but contained regression and should be fixed in batch 44 or an adjacent touch.
Review family: reviewer Claude in-process subagent; implementer codex.
