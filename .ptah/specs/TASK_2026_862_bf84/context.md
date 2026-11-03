# Task Context - TASK_2026_862_bf84

## User Request

Make Ptah use whatever Codex the user has, on every OS, so new OpenAI/Codex models work without a
Ptah release. Full workflow, worktree from main (feat/codex-binary-unpin), plan approved by the user
before any implementation.

### Problem (verified by user on main 7879839a1, after PRs #881 and #886)

- Electron never uses the user's installed codex. `createElectronCodexExecutable`
  (apps/ptah-electron/src/di/codex-runtime-composition.ts ~130) forces the bundled @openai/codex-*
  binary (0.165.0, via @openai/codex-sdk) and refuses global installs.
- `findCodexExecutablePin` (libs/backend/codex-runtime/src/lib/codex-executable-pin.ts) and
  `verifyCodexBinary` (codex-protocol-manifest.ts, called from codex-app-server-process.ts ~167) need
  an exact version + SHA-256 row from protocol/codex-app-server-protocol.manifest.json, which has ONE
  row: win32/x64. On macOS/Linux/Windows ARM Codex chat AND lanes fail ("No reviewed Codex
  executable pin for this platform"), also in dev with PTAH_CODEX_RUNTIME_DEV=1. #881 removed the
  translation proxy, so there is no fallback.
- Admission: apps/ptah-electron/src/di/codex-electron-admission.ts + CodexParityGate
  (codex-parity-gate.ts; never on) + codex-dev-route.ts. Chat admitted only for packaged win32/x64 or
  the dev env var.
- Models come from the binary (app-server model/list in codex-context.ts), so a pinned old binary
  hides new models.
- electron-builder.yml:53-58 already ships codex binaries for win32/linux/darwin x64+arm64.

### Acceptance criteria

1. Prefer the user's installed codex (PATH / standard install) when its version >= a minimum
   supported version; otherwise use the bundled codex. Show which one is used and why.
2. Remove the exact SHA and platform pin and the parity-gate/admission flags for chat and lanes.
   Keep a version check only (minimum, not exact). Delete dead gate code.
3. Tolerant protocol reading: ignore unknown fields, notifications and models; fail with a clear
   user-facing message only when a required method is missing or the version is below the minimum
   ("Codex X is not supported; using bundled Codex Y" or similar).
4. Model list stays dynamic from model/list. Remove any hardcoded Codex model allowlist (check
   codex-app-server-lane-models.ts, codex-model-rejection.ts, lane-spawn-policy.ts in
   libs/backend/cli-agent-runtime). A model missing from the #886 rate card still runs and shows
   tokens; cost shows as not priced.
5. Codex login/subscription (~/.codex auth) keeps working with both binaries.
6. Plan how the bundled codex stays current (automatic dependency bump).
7. Unit tests for binary selection, version check, tolerant parsing, unknown-model pricing.

### Rules

- Delegate research/implementation to CLI lanes (codex gpt-6-sol; Glm
  pc-355b645d-35af-4974-84cf-9cf961ea0164; Kimi pc-10e5a6b5-b237-4c72-a213-3202bd30d1fe). Lanes never
  run verify or git. Independent reviewer of another family before commit.
- No heavy local checks: at most `npm run verify -- -t typecheck -p <touched>` and
  `npx tsc -p libs/<lib>/tsconfig.spec.json --noEmit`; CI runs tests. Never npm install. Live
  Electron check only with a locked build-dev and 0 paid Codex turns unless authorized.
- Commit foreground, explicit paths, push background, PR, watch CI. Known flaky: electron-e2e
  hunk-revert-top-layer.spec.ts:174, git-real-git (macos) cancel, chat
  agent-card/stdout-visibility.spec.ts → rerun.
- User approves and merges. Never commit/revert task-tracking/landing-live-demo/HANDOFF.md, never
  commit real Codex session data, do not edit tools/mcp-bench.

### Follow-ups (out of scope unless needed)

F2 child usage inclusion (.ptah/specs/TASK_2026_codex_usage_pricing/coderabbit-886-r1-report.md),
Plan Limits shows only Weekly window, "Account not resolved" ~10 s after restart.

## Task Type

FEATURE

## Complexity

Complex

## Strategy

FEATURE, Full depth: research (2 lanes in parallel) → architect lane writes task-description.md,
parity-inventory.md and implementation-plan.md → cross-side review (other family) → Gate 2 with the
USER (user asked to approve the plan) → team-leader decomposition → implementation lanes →
typecheck → code-logic review (other family) → commit/PR/CI.

## CLI Lanes

- Preference source: current explicit user instruction (delegate to codex gpt-6-sol, Glm, Kimi).
- Mode: enabled. Approval mode: `user` (user asked to approve the plan before implementation).
- ptah_agent_list (2026-11-03): codex installed, confirmed room (Weekly 27%); Glm available,
  confirmed room (Weekly 52%); kimi code available, limits unknown; opencode AT LIMIT; grok,
  antigravity installed, unknown; copilot/claude disabled; cursor/pi not installed.

- 2026-11-03T04:11Z: Glm (pc-355b645d…, ollama-cloud) AT LIMIT — Session 100%, resets
  2026-11-03 05:00 UTC [error-derived + provider-api], while running lane B3. B3 moved to Kimi.
  At 04:55Z spawn refused (reset unknown) → Glm skipped for the rest of this run; codex reviewed
  the Kimi-authored files instead.
- 2026-11-03T05:23Z: kimi code (pc-10e5a6b5…) returned 429 "rate limit exceeded" at the end of
  the fix-round lane (edits done, report not filled); reset unknown.
- 2026-11-03T05:37Z: grok AT LIMIT (Weekly 100%, resets 2026-11-03 17:40 UTC) → re-review of
  codex fixes moved to antigravity (different family, limit unknown).
- 2026-11-03T05:38Z: antigravity 429 RESOURCE_EXHAUSTED (resets in ~70 h). No non-codex lane has
  room → re-review of codex fixes by an in-process Claude subagent (Subagent reason: all
  other-family lanes at limit; Claude ≠ codex family).

## Conversation Summary

- Worktree `.claude-worktrees/codex-binary-unpin` on `feat/codex-binary-unpin` from origin/main
  dd2f166da.
