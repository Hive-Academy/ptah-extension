# Context — TASK_2026_174

## User Intent

`/orchestrate task 174` — resume the filed BUGFIX for `terminal:create` spawning an
arbitrary renderer-supplied executable. The carrier `task.md` already contains a
complete problem statement, three phases (P1 reach, P2 allowlist+schema, P3
regression coverage), constraints, and six acceptance criteria. No requirements
elaboration is needed.

## Strategy

- **Task type**: BUGFIX (security — unvalidated input reaching `pty.spawn`)
- **Workflow depth**: Partial — requirements are already pinned by the carrier, so
  project-manager is skipped. Flow is `researcher-expert (P1) → software-architect
(P2 design) → team-leader MODE 1 → developer batches → QA`.
- **Why architect is included** despite BUGFIX's default flow: P2 introduces a new
  boundary contract (`terminal-rpc.schema.ts`, a per-platform shell allowlist, and a
  `cwd` containment rule) that is deliberately narrowing accepted input. The shape of
  the allowlist and the containment predicate are design decisions, not mechanical
  edits.

## Dependency

`depends_on: [TASK_2026_171]`. 171 is still marked `backlog` in its carrier, but its
output is present in the tree — `apps/ptah-electron/src/rpc-host-profile.ts` and
`libs/backend/rpc-handlers/src/lib/host-profile/` exist. The dependency is satisfied
in code; the 171 carrier status is stale and is **not** touched by this task.

## CLI Agent Delegation

`cli_delegation: disabled`

Discovery (`ptah_agent_list`) returned two agents: `cursor` (not installed) and
`ollama cloud` (ptah-cli provider, available). One available junior helper on a
small, security-critical, tightly-coupled change does not meet the delegation
heuristic (which wants 3+ independent file-disjoint tasks). Sub-agents run without
CLI helpers.

## Scope Boundaries

- Electron-only defect — `terminal:*` requires the `pty` capability, which only
  `apps/ptah-electron/src/rpc-host-profile.ts` enables. Do not add `pty` to another
  host profile.
- Not a VS Code Marketplace concern.
- Input narrowing is intended and must be documented in the PR body.

## Phase Log

| Phase                  | Agent               | Deliverable              | Status                                                                                                                                             |
| ---------------------- | ------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 — reachability      | researcher-expert   | `research-report.md`     | done — MODERATE, not a release blocker; only renderer-JS reaches the sink; shell/cwd have zero callers                                             |
| P2 — design            | software-architect  | `implementation-plan.md` | done — 5 batches, basename shell allowlist in platform-core, cwd containment via isAuthorizedTerminalCwd, spawn-site assertion in pty-manager spec |
| P2/P3 — decomposition  | team-leader MODE 1  | `tasks.md`               | pending                                                                                                                                            |
| P2/P3 — implementation | backend-developer   | code                     | done — 5 files created, 5 modified; platform-core 10/10, rpc-handlers 40/40, ptah-electron pty 4/4; typecheck + diagnostics clean                  |
| QA — security review   | code-logic-reviewer | `code-logic-review.md`   | done — SHIP-WITH-NITS, 0 critical/serious, 18 attacks defeated; F1/F2 inherited, F3/F4 minor follow-ups                                            |
| Commit                 | orchestrator        | `29f200095`              | done — 10 files, +582/-30, on ak/license-server-validation-pipe                                                                                    |
