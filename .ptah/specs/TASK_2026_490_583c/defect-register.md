# Defect register — lane A / lane B programme

Every defect found while running the lanes of `TASK_2026_490_583c` on 2026-09-21, and where each
one is now tracked. Recorded so that nothing found by a lane is lost when its worktree is
removed.

Measured against `origin/main` at `702c41413`.

## Filed as new tasks

| ID | Defect | Where it lives | Severity |
| --- | --- | --- | --- |
| `TASK_2026_519_4f1a` | The CDP automation `BrowserWindow` passes no `partition`, so it shares `session.defaultSession` with the trusted shell. Untrusted automated pages share cookies, local storage, HTTP cache and credentials with the application. | `apps/ptah-electron/src/services/electron-browser-capabilities.ts`, `createSession()` | Real today |
| `TASK_2026_520_9c2e` | 325 committed files under `.ptah/specs` contain an absolute workstation path or the developer account name. CWE-200. Recurs with every agent run. | `.ptah/specs/**` | Real today |
| `TASK_2026_521_3d8b` | `strictMcpConfig` is set nowhere in the repository. Without it a settings-file MCP server with a matching name starts a second upstream process and takes over the name — a second authorization path that bypasses `canUseTool`. | `libs/backend/agent-sdk/.../sdk-query-options-builder.ts` | Reachability on `main` is unverified — the task must establish it |

## Fixed in place

| Defect | Where | Fixed by |
| --- | --- | --- |
| `AgentProcessManager.stop()` stamped its terminal status after `killProcess`, so `handleExit` ran first, saw `status === 'running'` and relabelled a user-requested stop as `failed` — on the record, not only in the log. | `libs/backend/cli-agent-runtime/.../agent-process-manager.service.ts` | `TASK_2026_515_b7c3`, commit `e70d80b41` |
| Workstation paths in the three deliverables produced on 2026-09-21 (`security-review-antigravity.md` 8 occurrences, `spike-report.md` 1, `containment-comparison.md` 28). | `.ptah/specs/TASK_2026_49*` | Cleaned before the branches were pushed. The systemic fix is `TASK_2026_520_9c2e`. |

## Findings that belong to an open task, not to a new one

`TASK_2026_491_e0da` received an adversarial security review from a second vendor while its work
was still uncommitted. **Verdict: REJECT**, 3 blocking and 4 non-blocking findings. They are
defects in unmerged work, so they are fixed inside 491 and are not filed separately. The full
text is `.ptah/specs/TASK_2026_491_e0da/security-review-antigravity.md`.

Summary, so the register is readable without opening that file:

| # | Finding | Severity |
| --- | --- | --- |
| 1 | The permission allowlist admits `clipboard-sanitized-write`, but Chromium dispatches `clipboard-read` for `navigator.clipboard.writeText()` from a `file:` origin. All clipboard writing in the Electron app breaks. | BLOCKING |
| 2 | The media check branch requires `securityOrigin` to be defined. Electron does not supply it for a same-document permission query, so media checks fail closed and report `denied`. | BLOCKING |
| 3 | The generated CSP sets `img-src 'self' data: blob:` with no `https:`. Remote marketplace icons and external markdown images stop loading. | BLOCKING |
| 4 | The CDP automation window shares the default session. | Filed as `TASK_2026_519_4f1a` |
| 5 | `secureRendererHtml` is not idempotent, and the inline-script hash is computed from raw matched text. Running the copy twice emits two conflicting CSP `<meta>` tags; any whitespace change invalidates the hash and blocks the theme bootstrap script. | NON-BLOCKING |
| 6 | `parseTrustedUrl` compares `URL.pathname` by exact string equality. Windows `file:` drive letters vary in case, so a legitimate request can be denied. | NON-BLOCKING |
| 7 | Test fidelity. The specs supply `securityOrigin`, `mediaTypes` and `mediaType` to every case, which is what conceals findings 1 and 2. The CSP spec asserts the `<meta>` string, not enforcement. | NON-BLOCKING |

Finding 7 is the one to act on first. The tests passed green against logic that breaks at
runtime, which means the suite as written cannot gate this task.

## Process defects, recorded without a task

These are about how the lanes were run, not about the product. No task filed; they are written
down so the next run does better.

1. **Agent records were lost.** Four lane agent ids vanished from the host registry before their
   output was read. Every conclusion above comes from committed artifacts and independent
   re-verification, not from agent transcripts. Do not rely on the registry surviving a run.
2. **A concurrent session wrote into a worktree owned by this one.** `security-review-antigravity.md`
   in `TASK_2026_491_e0da` came from an agent this session did not spawn. The work is sound and
   was kept, but worktree ownership was not exclusive in practice.
3. **`git stash push -u` in the main checkout captured a concurrent session's six modified
   files.** Applied straight back and verified, nothing lost. A WIP commit is the correct tool;
   the stash stack is shared across worktrees.
4. **The 496 spike installed 268 MB of `node_modules` inside the task folder.** Untracked, and
   the spike added its own `.gitignore`, so nothing reached the index. Worth knowing before
   anyone copies the pattern.

## Documentation drift, recorded without a task

The root `CLAUDE.md` states **Electron 40** in its Tech Stack section, and
`apps/ptah-electron/CLAUDE.md` repeats it, including the ABI note "Electron 40 = ABI 143".
The installed and pinned version is **44.4.3** (`package.json:256`, `"electron": "^44.4.3"`).

Found by the `TASK_2026_491_e0da` fix lane, which read Electron's own type definitions to
rebuild its test fixtures and noticed the mismatch.

No task filed: it is a one-line correction in two files. It matters more than its size suggests,
because an agent that trusts the stated version reasons about the wrong API surface — which is
adjacent to how the permission-handler fixtures went wrong in the first place. Correct it in the
next change that touches either file.
