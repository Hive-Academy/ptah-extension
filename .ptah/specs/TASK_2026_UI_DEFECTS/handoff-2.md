# Handoff 2 — TASK_2026_UI_DEFECTS + TASK_2026_STREAMING_ARCH (2026-10-09)

Supersedes `handoff.md` for current state. Older reports in this folder are history only.

## Standing rules (from the user)

- Spend little of the orchestrator's own quota: delegate implementation and CI investigation to **codex** CLI lanes (`ptah_agent_spawn cli=codex`). Grok, opencode and Glm are at their limits; antigravity works for review only if needed.
- Every lane prompt repeats CLAUDE.md "STRICT: Verification commands (memory-safe)". Lanes never commit, push, stash, reset, restore or checkout — the orchestrator verifies, commits (explicit paths, never `git add -A`) and pushes.
- The user authorized merging: **"once the PR is green and all comments are addressed, merge them."**
- Commitlint scope enum: valid scopes include `auth-providers`, `cli-agent-runtime`, `ui`, `chat`, `chat-ui`, `rpc-handlers`, `shared`. `backend` is invalid.
- Lane verification is not proof — read the diff. Two lane fixes this round were wrong and were corrected (Mermaid SVG binding; phase 4 fence scan).
- GitHub network from this machine is flaky (`api.github.com:443 connectex`). Retry, or let a codex lane fetch logs.

## Worktrees (`.claude-worktrees/`, each has a `node_modules` junction)

| Worktree                                          | Branch                                   |
| ------------------------------------------------- | ---------------------------------------- |
| `fix-task-2026-ui-defects-a-backend-aac0d528f969` | `fix/task-2026-ui-defects-a-backend` (A) |
| main checkout `D:\projects\ptah-extension`        | `fix/task-2026-ui-defects-c-chat` (C)    |
| `feat-chat-mermaid-diagrams-0624908d5480`         | `feat/chat-mermaid-diagrams`             |
| `feat-streaming-p2-webview-scheduler`             | `feat/streaming-p2-webview-scheduler`    |
| `feat-streaming-p3-message-records`               | `feat/streaming-p3-message-records`      |
| `feat-streaming-p4-incremental-markdown`          | `feat/streaming-p4-incremental-markdown` |
| `feat-streaming-p5-composer-cls`                  | `feat/streaming-p5-composer-cls`         |
| `fix-elevation-backlog-2929c0c46697`              | `fix/elevation-backlog`                  |

## PR stack and state

| PR   | Branch → base         | State                                                                                                                                                   |
| ---- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #669 | A → `main`            | **3 failing CI jobs**: `electron-e2e`, `main`, `webview-e2e` (head `9c1cd80f1`). SonarCloud, CodeRabbit, CLI E2E, git-real-git pass. See "Open item 1". |
| #670 | B → A                 | **Merged** into A by the user.                                                                                                                          |
| #671 | C → A (retargeted)    | Green at last check. Retarget to `main` after #669 merges.                                                                                              |
| #673 | usage readers → C     | Green at last check.                                                                                                                                    |
| #674 | streaming phase 1 → C | Green at last check.                                                                                                                                    |
| #675 | Mermaid → C           | Sonar fix pushed (`22e201134`); re-check Sonar.                                                                                                         |
| #676 | phase 2 → #674        | Sonar fix pushed (`fac409b81`); re-check Sonar.                                                                                                         |
| #677 | review notes → C      | Green at last check.                                                                                                                                    |
| #678 | phase 3 → #676        | New.                                                                                                                                                    |
| #679 | elevation backlog → C | New. 5 typechecks passed locally.                                                                                                                       |
| #680 | phase 4 → #678        | New. Renderer fence-scan bug fixed before commit.                                                                                                       |
| #681 | phase 5 → #680        | New. Active-stream INP trace not yet measured.                                                                                                          |

Merge order: #669 → retarget #671 to `main`, merge → retarget/merge #673, #674, #675, #677, #679 (base C becomes main) → #676 → #678 → #680 → #681. After each merge, retarget the children to the new base and wait for green CI before the next merge. CodeRabbit reviews only PRs whose base is `main`, so each child gets its first CodeRabbit review after retargeting — address its threads before merging.

## Open items

1. **#669 CI (3 jobs).** A codex lane (agent `19adde4a-e6f7-4204-a1b3-fde95aefb0ae`) was investigating at handoff time. Its report: `.claude-worktrees/fix-task-2026-ui-defects-a-backend-aac0d528f969/.ptah/specs/TASK_2026_UI_DEFECTS/pr-669-ci-3-report.md`; any fix is **uncommitted** in the A worktree. Read the report and `git diff` there, verify (scoped typecheck/Jest only), commit to A, push, merge A into C (`git merge origin/fix/task-2026-ui-defects-a-backend` in the main checkout), push C. If the report is missing, spawn a fresh codex lane with the same task (fetch failing job logs via `gh run view --job <id> --log-failed`, fix root cause, no weakened assertions, no e2e runs).
   - Lane result (completed after handoff): fixed Electron + webview background-model picker e2e scenarios (Agent Orchestration move, unique tab locator) and the chat transcript `running: 0` expectation — all **uncommitted**. Its report says the `main` job also has failures **not caused by this branch** — read that section and decide (fix here, or prove they fail on `main` too).
   - Context: `webview-e2e` failed earlier because #670 moved Background Model Roles into Agent Orchestration; `29d6ebb62` fixed `skills-lane-pickers.e2e.spec.ts`. `9c1cd80f1` then changed tab-manager budget binding, message-router BATCH zone routing, wizard auth refresh, provider-account-card notice, welcome labels, `field.component` label binding and turn-test parsers — suspect these for new e2e failures.
2. **Re-check SonarCloud** on #675 and #676 after their fix pushes.
3. **Streaming phase 6 — zoneless** (plan D6 in `.ptah/specs/TASK_2026_STREAMING_ARCH/implementation-plan.md`, "Independently shippable phases" section; user approved a zone-based fallback flag kept for one release). Branch from `feat/streaming-p5-composer-cls`, new worktree + `node_modules` junction (`mklink /J`), codex lane, PR base #681.
4. **INP gate.** Ask the user for a Performance trace with an active stream while typing. Gate: p75 INP ≤ 200 ms, no interaction > 500 ms.
5. **Visual check.** Run `npx nx serve ptah-electron` for the user only when no lane is running heavy checks. Items to check: Settings card gaps, usage/limits radial gauges (dashboard + session stats), Background Model Roles look, Change link → Settings > Agent Orchestration, setup wizard inline provider/model, provider brand icons, provider switch refresh, Mermaid diagrams (now DOM-mounted with scoped CSS — confirm they render styled), streaming with several code blocks (phase 4), elevation backlog surfaces (#679).
6. **Optional:** add-memory API — the user has not decided; offer to skip.

## Reports from this round

- `pr-669-fixes-2-report.md`, `pr-669-webview-e2e-report.md`, `pr-669-coderabbit-3-report.md` (A worktree)
- `sonar-675-676-report.md`, `pr-ci-status-2.md` (C)
- `.ptah/specs/TASK_2026_STREAMING_ARCH/phase-3-report.md` … `phase-5-report.md` (in each phase worktree/branch)
