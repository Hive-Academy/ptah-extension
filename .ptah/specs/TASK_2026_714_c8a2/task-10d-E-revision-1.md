# Task: batch 10d.E revision 1 (TASK_2026_714_c8a2)

HARD RULES (read first):
- Do NOT run verify, tests, typecheck, lint, build, nx, npm or ptah_get_diagnostics. The coordinator runs all checks.
- Do NOT commit, push, stash, reset, restore, checkout or clean. Never revert a change you did not make.
- Never strip, revert or comment out MCP (Ptah MCP or user MCP servers).
- Work only in the worktree W = D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration. Use absolute paths.
- Electron first. Do not edit apps/ptah-tui, apps/ptah-extension-vscode, libs/backend/cli-engine.
- No `any`, `as unknown as`, `@ts-ignore`, `eslint-disable`. Use bracket access `process.env['X']`.
  A swallowing catch needs `// degradation-audit: optional-capability|reported - <reason>`.
- Write files as UTF-8 without BOM, LF line ends.

## Objective

Fix the 7 defects of the code review of batch 10d.E and apply decision D27. The 10d.E code is
uncommitted in W. Keep all 10d.E behaviour that the review marked "met".

## Inputs (read these first)

- Review with full defect text and evidence: W\.ptah\specs\TASK_2026_714_c8a2\code-logic-review-10d-E.md (defects 1-7)
- Your 10d.E report: W\.ptah\specs\TASK_2026_714_c8a2\batch-10d-E-report.md
- Decision D27 (last row): W\.ptah\specs\TASK_2026_714_c8a2\decisions.md (also D26 for R1)
- Plan: W\.ptah\specs\TASK_2026_714_c8a2\plan-p10.md and plan-p10-review.md (R1-R4), batch 10d.E
- Code: W\apps\ptah-electron\src\di\codex-lane-composition.ts, codex-runtime-composition.ts (+spec),
  phase-2-libraries.ts, container.smoke.spec.ts;
  W\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane-auth.ts (+spec),
  codex-app-server-lane.adapter.ts (+spec), codex-thread-identity-store.ts;
  W\libs\backend\codex-runtime\src\lib\di\registration.ts (resolveGatedCodexRuntime);
  W\libs\backend\agent-sdk session-metadata-store.ts (for defect 2).

## Work items

1. (major, defect 1) Add W\apps\ptah-electron\src\di\codex-lane-composition.spec.ts
   (`import 'reflect-metadata'` first, fake spawner, fake runtime through the registration ports,
   jest fake timers where needed). Cases: (a) create() and detect() spawn no process;
   (b) chat context and lane contexts keep their own profile/fingerprint after the other opens,
   both directions (R3), also after a second lane with other options; (c) profiles.resolve,
   credentials.check, openCatalog and readCodexUserMcpServerNames all get the same CODEX_HOME
   when env['CODEX_HOME'] differs from process.env['CODEX_HOME']; (d) runtime.open rejects a
   non-lane profile; (e) close() on the owned context disposes the scope once; a failed open
   disposes the scope.
2. (major, defect 2) Lane thread identities must not become chat session rows. Today the lane
   store writes `codex-app-server` SessionMetadata rows through SDK_SESSION_METADATA_STORE.
   Give lanes their own key space or a `consumer: 'lane'` marker that chat session listings and
   chat resume reject, or a separate store. Choose the smallest safe option, record it under
   `## Decisions` in the deliverable, and add a spec that a lane row is excluded from chat
   listings and chat resume (or never reaches the chat store).
3. (major, defect 3 + D27) Route every lane open through one host helper (the single lane
   routing boundary): `resolveGatedCodexRuntime(scope, 'lane', platform)` when the lane gate
   admits `lane`; the raw Runtime token only under the unpackaged (dev) default. Bind
   CODEX_ADAPTER_FACTORY only when the gate admits `lane` or the host is unpackaged. A packaged
   host with the gate closed binds no factory and keeps the legacy SDK lane. Replace the
   misleading "lane gate closed" assertion in codex-runtime-composition.spec.ts with D27 cases
   (packaged+closed: no factory; packaged+admitted: gated runtime; unpackaged: native default).
   PTAH_CODEX_RUNTIME_DEV must not cover lanes.
4. (minor, defect 4) Use `||` for the HOME/USERPROFILE fallback. An empty CODEX_HOME is an
   explicit unusable home with one visible message (no relative path). Add the spec case.
5. (minor, defect 5) Pass a lane `requestUserInput` port: emit the same kind-only line as the
   lane approval sink and decline (R1/D26). Add a spec case.
6. (minor, defect 6) Catalog profile: use the adapter's lane default model constant
   (CODEX_LANE_DEFAULT_MODEL or the existing exported name), and do not use CODEX_HOME as
   cwd/workspace; use a neutral temp or read-only cwd.
7. (minor, defect 7) Replace the source-text indexOf order check in container.smoke.spec.ts:
   resolve CliDetectionService after composePhase2 and assert its codex adapter is
   CodexAppServerLaneAdapter in the case where D27 binds the factory (and the legacy adapter
   where it does not, if the smoke harness can set packaged).

## Scope

Only the files listed in Inputs/Code, the new spec file, and the deliverable. If item 2 needs a
change in another file (for example the agent-sdk metadata store or a chat listing filter), make
the smallest change and list it in the deliverable. Do not modify anything else.

## Deliverable

**Deliverable**: D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-10d-E-revision-1-report.md
Write it first as a skeleton (headings per item), then fill it in. Per item: files and lines
changed, specs added, status. Add `## Decisions` and `## Not done`.

Reply only: `WROTE: <absolute path>` plus a one-line headline. Call ptah_agent_report once before
the final message with the files written and anything not done.
