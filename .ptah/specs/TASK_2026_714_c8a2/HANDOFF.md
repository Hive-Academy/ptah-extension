# Session handoff — TASK_2026_714_c8a2 (session 4)

Written 2026-10-23 at the user's request (session at 27.6M tokens). Replaces the session 3 handoff.
No lane, subagent or background command of this task is running. This session holds no heavy-check
slot.

## Goal

One Codex runtime for Ptah: the Codex App Server, shared by main chat, the messaging gateways and
CLI lanes through ONE core lib (`@ptah-extension/codex-runtime`) and thin adapters. The two current
paths (main chat = Claude Agent SDK + Codex translation proxy; lanes = `@openai/codex-sdk`) are
migration sources, retired only after proven parity and separate user confirmation (Removal A:
proxy, Removal B: codex-sdk lanes). Claude behavior stays unchanged. Electron first. No
runtime-selector UI. A visible refusal is not parity. Production stays disabled until the evidence
spike proves the required observations (`implementation-plan.md:262-270`).

## Done this session (pushed unless stated)

Worktree `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat`, branch
`feat/codex-sdk-main-chat`, draft PR https://github.com/Hive-Academy/ptah-extension/pull/809.
Remote head `bacc19168`.

| Commit | Content | Review (Review family: Claude reviewer, Codex implementer) |
| --- | --- | --- |
| `4f52c5913` | style: prettier on harness/spec/cases (HEAD was never formatted; token-identical) | none (format only) |
| `60a4833a0` | Batch 1c + fix round: sanitized command shapes (experiment, home, temp, cwd, CODEX_HOME, auth paths -> placeholders, other abs paths -> `<PATH>`, sanitize before 400 cap), granular all-true ask policy + approvalsReviewer "user", separate approval-policy mismatch message, missing-approval note gating; frames/failure notes extracted | `code-logic-review-batch-1c.md` REVISE 7 -> fixes -> `code-logic-review-batch-1c-fixes.md` APPROVED 8.5 |
| `80574a804` | Batch 1d: `initialize` declares `capabilities.experimentalApi=true` for granular cases only; granular policy + reviewer confirmed from the `thread/start` response; `RPC error <code>` recorded | `code-logic-review-batch-1d.md` APPROVED 8.5 |
| `51781113c` | Batch 1e: marker writer as per-case script file; `commandMatches` accepts exact or exactly `"<abs>\(powershell|pwsh).exe" -Command "<expected>"` on win32, in both gates | `code-logic-review-batch-1e.md` APPROVED 8 |
| `f63d64d58` | Batch 1f: forward-slash paths in the expected command (no backslash, no `"`); differs-by labels | `code-logic-review-batch-1f.md` APPROVED 7 |
| `0237d33ca` | Batch 1g: command on its own line in the prompt (run 6d copied a trailing period) | none (prompt text = measurement, rule 3) |
| `36fb38bca`, `000489ef7`, `94488fb0e`, `7bcb5e106`, `7b6adc876`, `bacc19168` | docs: reviews, reports, spike runs 6–6d, decisions | — |
| `5485eba33` | docs: spike run 6e, `native-route-evidence.md` update | **LOCAL ONLY, not pushed** |

Uncommitted: `decisions.md` (2 rows: usage bound approval, Batch 1h plan), `spike-runner.ts`, this
`HANDOFF.md`. Commit them as docs and push with the next code batch (needs the heavy-check slot:
the pre-push gate runs di-lint + Electron validate-deps).

Last scoped checks (on `0237d33ca`): `nx run-many -t test typecheck lint -p codex-runtime` ->
test 104/104, typecheck pass, lint 0 errors, 2 old warnings (max-lines 1717 > 700, accepted for
this spike tool; no-useless-assignment).

CI: `bacc19168` all jobs pending at handoff, none failed. Earlier heads were not watched to the end.
Run `gh pr checks 809` first.

## Spike results (runs 6–6e, model gpt-6-luna, bundled codex 0.155.1, copied auth only)

Turns: **7 of 14 used, 7 remain**. No `%TEMP%\ptah-codex-evidence-*` leftover after any run.

| Run | Turns | Result |
| --- | --- | --- |
| 6 | 0 | `thread/start` -32600 "askForApproval.granular requires experimentalApi capability" |
| 6b | 1 | identity gate: Codex wraps as `"<abs>\powershell.exe" -Command "<cmd>"`; inline `-e` script escaped |
| 6c | 1 | wrapper accepted; inner-path backslashes came back doubled |
| 6d | 1 | forward slashes matched except a copied trailing period; first granular `requestApproval` |
| 6e | 3 | **ask-command-accept OBSERVED** (granular all-true + read-only: request arrived with marker absent; accept -> marker written). ask-command-deny: request, decline, no marker, then "Cumulative usage ceiling reached" (23425 > 12000). **compaction OBSERVED** |

Facts learned: `item/started` for a command arrives BEFORE `item/commandExecution/requestApproval`.
Each turn reports ~11.7k tokens (~11.5k input). `thread/start` echoes `approvalPolicy` and
`approvalsReviewer`. Granular approvals need the experimental API opt-in (stability risk to carry
into the core design and gap table).

## User decisions this session (in `decisions.md`)

1. Turn budget raised to **14 total** (same bounds otherwise).
2. Usage bound: stop a run when one turn reports **> 15000** tokens or the cumulative observed total
   passes **100000** (replaces the 12000 ceiling). One-turn overshoot remains possible.
3. Earlier decisions still stand: edited input -> prove a native alternative (decline +
   `turn/steer`); ask level -> adopt granular only if it proves ask-before-effect, else back to the
   user.

## In progress — Batch 1h (NOT started; plan recorded in `decisions.md`, last row)

1. Usage bounds in `evidence-harness.ts`: `USAGE_CEILING` (:43) -> cumulative 100000 plus a
   per-turn 15000 bound (`UsageBudget` :422-434; observe sites ~:923, :1341; run loop :1664).
2. New case `ask-command-edit` in `evidence-cases.json` (kind command, level ask, turnCost 1):
   first `requestApproval` for the original command -> decline + `turn/steer` (schema
   `TurnSteerParams` at `codex-app-server-protocol.schema.json:25233`) with the edited command that
   writes the replacement marker (`${item.id}.replacement.marker`, harness ~:1090) -> the second
   request must match the edited command exactly (`commandMatches`) -> accept -> replacement marker
   written, original never written. Record whether steer is charged as a turn and its usage.
3. Spec coverage for both. Then scoped checks, a different-family review, commit, push.
4. Runner for run 6f (`spike-runner.ts`, copy to `/tmp/run6/runner.ts` or run in place): drop the
   proved `ask-command-accept` and `compaction`; run deny, edit, file, plan, auto-edit, yolo, mcp
   = 7 turns, refuse a plan above the remaining 7. Note: `ask-command-accept` is the compaction
   source (`item.id === 'ask-command-accept'` flag), so dropping both together is consistent.

## Open problems

- Granular for sandbox-ALLOWED commands is untested (sandbox_approval asks only on escalation);
  run 5 shows on-request also asked for the same write. Ask-level parity is not proved yet. Bring
  the granular adoption question to the user after run 6f.
- Edited input: decline + `turn/steer` unproved (Batch 1h).
- Experimental API dependency for granular approvals.
- Usage is observed, not enforced mid-turn (run 6e overshoot shows it).
- Review leftovers recorded, not fixed: 1c M2 (file-change note has no detail), 1d M1 (no spec
  drives runCase order), 1e Moderate (UNC/any abs powershell path; note hidden after deadline),
  1f Moderate ("doubled backslashes" label can no longer fire; no forward-slash outside-root spec),
  GLM F2 (cleanup status when createExperiment throws early). Later task: split the 1717-line
  harness if it outlives the spike.
- Version drift: global codex 0.163.0, bundled 0.155.1; core must check the manifest pin.

## Peer coordination

- TASK_2026_712 (PR #808, not merged) owns until merged: agent-sdk `sdk-agent-adapter.ts`,
  `session-query-executor.service.ts`, `sdk-query-options-builder.ts`, `sdk-query-runner.service.ts`,
  `session-registry.service.ts`, `session-metadata-store.ts`, `session-quota-probe.service.ts`,
  `sdk-model-service.ts`, agent-sdk `di/register.ts`; rpc-handlers `chat-session.service.ts`,
  `chat-slash-command-router.service.ts`, `session-rpc.handlers.ts`; NEW Batch 21:
  `chat-session.account-binding.spec.ts`, `chat/session/child-chat-session-host.adapter.ts`,
  cli-agent-runtime `session-children/session-spawner.{port,service}.ts` (714 acked). Rebase on
  #808 before any 714 batch touches these. Migration 0059 is theirs; 714 uses 0060+.
- tsyringe: use `{ useFactory: () => null }`, never `{ useValue: null }`.
- Heavy-check slot: sessions `ptah-ptah-extension-providers-account-v3-…` (712),
  `ptah-ptah-extension-fixing-designs-…` (717), `ptah-ptah-extension-nx-upgrade-…`. Claim by
  message, wait for "slot free"/"released", send "released" after your push gate. Use ListAgents
  for current addresses.
- Shared `node_modules` (no own copy). Never `npm ci`/`npm install` in this worktree.

## Key files

Task folder `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/.ptah/specs/TASK_2026_714_c8a2/`:
`decisions.md`, `native-route-evidence.md`, `implementation-plan.md`, `batch-1c/1d/1e/1f-report.md`,
`code-logic-review-batch-1c*.md` … `-1f.md`, `spike-run-6.md` … `spike-run-6e.md` (+ `.json`),
`spike-runner.ts`, `codex-version-contract-report.md`.
Code: `libs/backend/codex-runtime/tools/` (`evidence-harness.ts`, `evidence-harness.spec.ts`,
`evidence-cases.json`, `evidence-failure-notes.ts`, `evidence-frames.ts`).
Bundled binary: `D:/projects/ptah-extension/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe` (0.155.1).

## Next steps

1. Read this file, the last 12 rows of `decisions.md`, and `native-route-evidence.md` (Summary and
   Next spike step).
2. `gh pr checks 809`; read failed job logs if any.
3. Batch 1h via a fresh Codex lane (`backend-developer`, workingDirectory = worktree, the three
   tools files + `evidence-cases.json` only, ≤ 30 tool calls, no checks, no git). Run
   `ptah_agent_list` first.
4. Different-family review (Claude `code-logic-reviewer` subagent), deliverable
   `code-logic-review-batch-1h.md`. One fix round.
5. Claim the heavy-check slot, then
   `npx prettier --write libs/backend/codex-runtime/tools/*.ts libs/backend/codex-runtime/tools/*.json`
   and `npx nx run-many -t test typecheck lint -p codex-runtime --parallel=1 --output-style=static --skip-nx-cache`.
6. Commit in the foreground (code: `fix(codex-runtime): ...`; docs incl. `5485eba33` follow-ups,
   `decisions.md`, `spike-runner.ts`, `HANDOFF.md`: `docs(task-specs): ...`), push in the
   background, release the slot.
7. Adjust `spike-runner.ts` per Batch 1h item 4, dry run, then real run 6f:
   `npx ts-node --project libs/backend/codex-runtime/tsconfig.spec.json <runner> --dry-run`
   `npx ts-node --project libs/backend/codex-runtime/tsconfig.spec.json <runner> --run --binary 'D:/projects/ptah-extension/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe' --auth-source "$USERPROFILE/.codex/auth.json" --model gpt-6-luna --out 'D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/.ptah/specs/TASK_2026_714_c8a2/spike-run-6f.md'`
   After the run: `ls -d "$TEMP"/ptah-codex-evidence-*` must list nothing. Record turns and usage
   (7 turns remain; 100000 cumulative bound).
8. Update `native-route-evidence.md`; bring the granular/ask-level result, the edited-input result
   and any further turn or usage request to the user.
9. Then team-leader decomposition of the core batch, respecting the 712 claims.

Rules: CLAUDE.md (memory-safe scoped checks, one heavy check at a time, commit in the foreground,
push in the background, never commit to main, never `npm ci` in this worktree). The temporary
"CLI lanes first" rule expires 2026-10-24; the user allowed Claude subagents, Codex and GLM lanes.
