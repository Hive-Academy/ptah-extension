# Backlog polish report, part 01 (TASK_2026_886_032a, phase 2)

Polisher: backlog-polisher-01. Scope: the 29 folders in `work/polish-part01.txt`. Code base: this
branch (`origin/main` 390808edf plus task-file commits). No status line changed. No git write, npm, nx
or verify command ran. `git apply --check` (read-only) and `git ls-remote` (read-only) ran once each.

## Counts

- Polished: 29 (every `task.md` in the list: `updated:` set, `description` made a one-to-three-line
  `>-` scalar, `## Description` made current, `## Current state (2026-11-07)` added).
- Unchanged (already current): 0.
- Notes added to history files: 11 (`459/context.md`, `460/context.md`, `468/context.md`,
  `481/context.md`, `481/implementation-plan.md`, `520/context.md`, `528/context.md`,
  `529/context.md`, `560/implementation-plan.md`, `560/task-description.md`, `561/context.md`).

## Table

| Task | What changed | Removed old claims | Confidence |
| --- | --- | --- | --- |
| TASK_2026_454_b401 | Named the three agent-sdk imports with lines; cited the cycle comment at `queue-slot-timeout.ts:14-15` | "Cross-Lib Rules sentence" (rule gone, PR #562); noted agent-sdk imports memory-contracts, not memory-curator | high |
| TASK_2026_455_9f2c | Added current batch size, minimum, deferral and debug log lines | none wrong; long description shortened | high |
| TASK_2026_456_b421 | Full spec paths; bench spec already uses a ratio check; skills.sh spec only raised its timeout | `.../` path stubs; `--parallel=2` proof replaced with `npm run verify` | med |
| TASK_2026_457_e48b | Site moved to `memory-storage-health.ts:139-152`; DTO and panel lines added | old line range `:97-110` | high |
| TASK_2026_458_39c2 | Retargeted from the removed CLI app to the cli-engine boot inside the Electron-built `worker-host.mjs`; refreshed all line numbers | "the CLI host" / "CLI crashes at boot" | high |
| TASK_2026_459_fc7d | Rescoped to "confirm in Electron, then close": `getAll()` now reads every project from the global SQLite store | "reads the active workspace delegate only"; proposed aggregate reader | med |
| TASK_2026_460_0398 | Refreshed `createChild`, merge and `create` lines; listed all four callers | old line numbers (`:1166-1184`, `:456-471`) | high |
| TASK_2026_468_a0e4 | Wrote the body; the parked patch no longer applies (checked) and must be ported by hand | "git apply --check passed"; patch target `apps/ptah-electron-e2e/CLAUDE.md` is gone | high |
| TASK_2026_476_a1c9 | Rescoped to the session-stats cache-rate path only | whole Codex-lane section (cached tokens now mapped, `codex-cli.adapter.ts` gone); old `pricing.utils.ts:289-290` | high |
| TASK_2026_479_4e71 | Wrote the body: back-off done (PR #539); tree-kill gap and drive-letter duplicate open | absolute workstation path in the body (now a placeholder) | med |
| TASK_2026_481_7b0f | Wrote the body pointing to the finished design; noted only Electron and the cli-engine worker host need a degrade path | VS Code/CLI host degrade rows; "design first" (design done) | med |
| TASK_2026_495_2d9f | Wrote the body with current anchors; dependency 494 is `done` | "Depends on: TASK_2026_494" as a blocker | high |
| TASK_2026_501_3e9b | Release branches were never synced after the build fix (remote heads checked) | "See the root CLAUDE.md" (no such rule there) | high |
| TASK_2026_503_8f60 | CI already checks packed natives on macOS/Linux; manual install still open | node-pty check (dependency removed, `277f98ed8`); DB path `~/.ptah/ptah.db` | high |
| TASK_2026_504_b25e | Seven current import sites listed; blocking question retargeted to the Electron renderer | VS Code webview secure-context question; "six files" | high |
| TASK_2026_506_4a8f | Re-counted the class blast radius; five custom themes, not six; `theme-extra.css` path noted | "six themes", "about 700 occurrences", VS Code webview browser floor | high |
| TASK_2026_508_e5b1 | Only one npm script uses cross-env; serve run needs user approval | "run every npm script" | high |
| TASK_2026_513_a7c2 | Lane decision is made and labelled (`lane · not in totals`); left: footer reconciliation and four-field specs | Orchestra tile header (replaced) | med |
| TASK_2026_517_b90a | Wrote the body; named candidate channels (notification center, host attention port) | "Depends on TASK_2026_511, which must merge first" (511 is done) | high |
| TASK_2026_520_9c2e | Re-counted: 822 tracked files; no guard in lint-staged, husky or CI | "325 files" | high |
| TASK_2026_522_c6b1 | Named the real source (`~/.ptah/mcp-oauth-installed.json` via `os.homedir()`) and launcher lines | none wrong; long description shortened | high |
| TASK_2026_528_5d1e | Counts now 36 of 40 strict; verify through `npm run verify`, not `nx run-many` | "twenty-five of twenty-nine", `tsconfig.base.json:229`, `nx run-many` commands | high |
| TASK_2026_529_b482 | Defect confirmed live: 29 files use the badges; anubis-light lines added | triage claim "no template uses badge-success/info" (wrong, note added) | high |
| TASK_2026_539_67f5 | Wrote the body; only Apps claims the inbox; no `surface:release`; 853 is done | "host tests on three hosts" | high |
| TASK_2026_550_9a28 | Problem 2 (start-up hang) marked done (PR #597); only the worker-scoped fixture is left | start-up hang as open scope | high |
| TASK_2026_557_9dbc | Current probe chain with lines; probes already use piped stdio, so re-measure first | VS Code host signature constraint | med |
| TASK_2026_558_f761 | Current adapter and launcher lines; `PTAH_E2E` does not skip rival-CLI registration | none wrong | high |
| TASK_2026_560_2ae5 | Title and scope narrowed to PR 2: rival-lane MCP enforcement, schema sizes, remove the `ptah-cli-proxy` row | CLI proxy enforcement, CLI warning print, Ptah CLI unverified notice (PR #892) | med |
| TASK_2026_561_9e57 | Wrote the body: Track B only; dropped removed-host items; spot-checked B5, B6, B8 | Track A compaction scope in the body; B5 VS Code startup run; B7 `ptah-cli` checks and `codex-cli.adapter.ts` | med |

## Status proposals

| Task | Proposed status | Evidence |
| --- | --- | --- |
| TASK_2026_459_fc7d | done (after one check in Electron) | `bf152e823`: `SessionMetadataStore.getAll()` reads `records.listAll` ("every project of this host", `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:1892-1897`). `listAll` filters by host only (`libs/backend/persistence-sqlite/src/lib/session-store/sqlite-session-record-repository.ts:114-123`). Electron binds the repository (`apps/ptah-electron/src/di/phase-1-infra.ts:167`). The active-delegate fallback was the VS Code path, which is removed. |

## Unclear

| Task | What could not be checked |
| --- | --- |
| TASK_2026_456_b421 | Whether each flake still recurs. Needs a parallel test run, which this phase does not allow. |
| TASK_2026_459_fc7d | No running app check that a cross-workspace peer row shows its title. |
| TASK_2026_476_a1c9 | How many catalog entries lack a cache rate (needed for the free-versus-unknown decision). |
| TASK_2026_479_4e71 | Whether Ptah or the `claude` subprocess owns the orphaned MCP tree, and whether Ptah writes the `~/.claude.json` project keys. |
| TASK_2026_513_a7c2 | Whether the MODEL field and the footer already agree. I found no four-field spec, but did not read every stats spec. |
| TASK_2026_557_9dbc | Whether the 28 s close delay still happens. Probes already use piped stdio and a 5 s timeout. |
| TASK_2026_561_9e57 | Items B1, B3, B4, B6 (other than two), B7 and B9 were not checked one by one. |
| Several | `id` and/or `created` are missing from the frontmatter of 476, 479, 481, 501, 503, 504, 506, 508 and 517 (no `id` or `created`), and of 495, 513, 520, 522, 528 and 529 (no `created`). The brief keeps fields as they are, so I did not add them. |
