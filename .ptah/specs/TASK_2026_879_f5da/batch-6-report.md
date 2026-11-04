# Batch 6 report — report skill and live routing

## Hook located

The live per-prompt hook is `UserPromptSubmitHookHandler`:

- `libs/backend/agent-sdk/src/lib/helpers/user-prompt-submit-hook-handler.ts:119` — new call `surfaceHookGuidance(input.prompt)`, joined into `hookSpecificOutput.additionalContext` for the current turn. This is the actual auto-load/suggestion hook; `routing-reminder.format.ts` only formats the next-turn lane reminder.
- Prompt-level wiring already in place and updated through the hint constants:
  - `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:352` appends `PTAH_UI_HINT` (Claude host, skill lookup available).
  - `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:445` appends `PTAH_UI_HINT_CODEX` (no skill-file lookup).

## Files changed

1. `.claude/skills/ptah-surface-authoring/SKILL.md`
   - New top section **Reports and visual views** (line 6) before any ptah-ui guidance.
   - Front-matter description now names reports/dashboards and `ptah_artifact_publish`.
2. `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.ts`
   - `PTAH_UI_HINT_SHARED` now carries the report → HTML publish rule; `PTAH_UI_HINT_CODEX` is that shared text only.
   - Added `routeSurfaceRequest(text, { skillLookup })`, `surfaceHookGuidance(prompt)`, and report/visual classifiers.
   - With skill lookup: names `ptah-surface-authoring`, `frontend-design`, `dataviz`.
   - Without skill lookup (Codex/other hosts): same publish rule, no skill names.
3. `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.spec.ts`
   - Byte-exact hint assertions; report-vs-compact table; host-without-skill-lookup regression.
4. `libs/backend/agent-sdk/src/lib/prompt-harness/index.ts` and `libs/backend/agent-sdk/src/index.ts`
   - Export the new routing helpers and types through the public alias surface.
5. `libs/backend/agent-sdk/src/lib/helpers/user-prompt-submit-hook-handler.ts`
   - Injects current-turn surface guidance after the pointer and next-turn reminder.
6. `libs/backend/agent-sdk/src/lib/helpers/user-prompt-submit-hook-handler.spec.ts`
   - Asserts a report prompt produces report guidance and a compact prompt produces none.
7. `libs/backend/rpc-handlers/src/lib/chat/host-routing/routing-reminder.format.ts`
   - Added `formatSurfaceRouteReminder(prompt, skillLookup)`; lane reminder itself stays surface-free.
8. `libs/backend/rpc-handlers/src/lib/chat/host-routing/routing-reminder.format.spec.ts`
   - Report guidance with skills, report guidance without skill lookup, null for compact; lane reminders stay free of surface instructions.

## New rule (short)

> When the user asks for a report, dashboard, prototype, or any visual/representational view of their work, do not answer with ptah-ui blocks alone. Load `ptah-surface-authoring` plus any available design/data-visualization skill (`frontend-design`, `dataviz`), gather verified data, publish one attractive self-contained HTML artifact with `ptah_artifact_publish`, then describe it in one sentence in chat. ptah-ui stays for compact host-verified summaries. The artifact remains one `index.html`, max 2 MiB UTF-8, inline CSS/JS, no network/CDN/remote fonts/images, with the host light/dark theme bridge.

Compact classification deliberately excludes `bug report`, `error report`, `report this bug`, and plain recaps such as `summarize this turn` / `show the test results`.

## Verification

Command (exact Nx names resolved from `project.json`):

```text
npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/rpc-handlers
```

Key lines:

```text
NX Running targets lint, test, typecheck for 2 projects
Failed tasks:
- @ptah-extension/agent-sdk:test
- @ptah-extension/rpc-handlers:test
Output of 4 successful tasks were not shown.
```

- Both projects' **lint** and **typecheck** passed (4 of 6 tasks; the 2 failures are test tasks only).
- agent-sdk: 3 failed suites / 5380 tests passed. Failures are `off-thread-process-spawner.spec.ts`, `plugin-loader.service.capabilities.spec.ts`, `plugin-loader.service.session-notice.spec.ts` (process/plugin filesystem timeouts).
- rpc-handlers: 9 failed suites / 6017 tests passed. Failures are `chat-session-*`, `install-scope-*`, `skills-sh-source-root`, `plugin-rpc.handlers.session-notice` (filesystem/Windows temp timeouts and `ENOTEMPTY`).
- None of the changed specs failed: `ptah-ui-hint.spec.ts`, `user-prompt-submit-hook-handler.spec.ts`, `routing-reminder.format.spec.ts` are absent from the failure list.
- Failures are outside this batch's files and look like concurrent-lane/Windows temp contention, not the report routing change.

Log: `.ptah/specs/TASK_2026_879_f5da/verify-batch6.log`.

## Not done

- No commit, push or PR (per instruction).
- Did not render an HTML artifact in a browser for this batch; no UI artifact was authored here.
