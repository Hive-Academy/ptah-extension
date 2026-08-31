# TASK_2026_361 — Context

## User intent (verbatim, condensed)

1. "The generated subagents are not showing in the file changes; the workflow says
   agents are being generated but the files did not change."
2. "The enhanced system prompt — no way to tell if it got updated. Save a local file
   along with the analysis folder."
3. "The analysis did not properly write down the elevation plan."
4. "Is there a way to make that workflow pausable and survive terminations and
   continuations easily?"
5. "Make `.claude/agents`, `commands`, `skills`, `output-styles` write to git and not
   ignored; we can ignore the other folders and files."

## Orchestrator findings (2026-08-31, evidence from code + Electron logs)

### F1 — Generated agents: written, invisible, late, unpropagated

- `.gitignore:158` `.claude/agents/*` + `:159` `!.claude/agents/video-director.md`.
  Git tracks 1 of 15 agent files. The other 14 never appear in "file changes".
- Log `Ptah Electron-2026-08-31.log`: `wizard:submit-selection started` 00:17:08Z →
  `Error: Agent generation exceeded 10-minute timeout` 00:27:08Z → 15 ×
  `Agent written successfully` at 00:27:32Z. The watchdog at
  `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts:536`
  rejects the `Promise.race` but does not abort the orchestrator; the failure branch
  broadcasts `success:false`, and `propagateGeneratedAgents` (`:579`) never runs.
  `~/.ptah/user/agents` mtime is still 2026-08-30 19:52 → rival CLIs got nothing.
- All 15 written files are byte-identical to the previous run. 11 ×
  `Section X: generated text rejected, keeping authored fallback` with reason
  `cites path(s) the analysis never surfaced` (includes non-paths such as
  `*.spec.ts`, `@nx/enforce-module-boundaries`). Zero tailoring shipped.
- `GeneratedSectionValidator` over-rejection is a SEPARATE follow-up, out of scope
  here unless the architect finds it trivial.

### F2 — Quality audit and elevation plan are 85 B / 41 B stubs marked "completed"

- `.ptah/analysis/ptah-extension/03-quality-audit.md` = "I'll start by loading the
  tool schemas I need and reading the previous phase outputs."
  `04-elevation-plan.md` = "Iading the three previous analysis files."
  Manifest: both `status: completed`, `durationMs ≈ 902000` (= `PER_PHASE_TIMEOUT_MS`
  900_000 at `libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.ts:71`).
- Log: `[MultiPhaseAnalysis]:quality-audit Stream ended without result` 17:44:52Z,
  same for elevation-plan 17:59:54Z. The abort via
  `phaseAbortController.abort('analysis_timeout')` did not surface as an error; the
  stream simply ended.
- Defect A: `multi-phase-analysis.service.ts:226-240` — no file + any captured text
  ⇒ `completed`, text written as the phase file.
- Defect B: `multi-phase-analysis.service.ts:517-519` collects `textChunks` from UI
  stream events which `sdk-stream-processor.ts:39,138` throttles to one per 100 ms.
  The fallback text is a lossy sample by construction ("Iading").
- Consumers trust `completed`: `enhanced-prompts.service.ts:916` fed both stubs to
  the prompt designer (log: `phasesLoaded: 4`); `analysis-results.component.ts:97`
  renders them as done.
- Why the agent stalled for ~10 min after its first tool call is NOT in the log
  (phase 3: one `ptah_get_diagnostics` 45 s then silence; phase 4: two
  `execute_code` calls then silence). Root cause of the stall is out of scope; the
  handling is in scope.

### F3 — Enhanced prompt has no on-disk trace

- `runWizard` (`enhanced-prompts.service.ts:312-501`) stores `generatedPrompt` only
  via `EnhancedPromptsStateStore.save` → VS Code `globalState`
  (`enhanced-prompts-state-store.ts:61-68`). It DID update today (00:27:08–00:28:27Z,
  6158 chars; `chat:start` at 00:31:32Z logged `hasEnhancedPrompts:true`).
- `analysisDir` already reaches `runWizard` from
  `enhanced-prompts-rpc.handlers.ts:306` and from `regenerate` (`:557-564`).

### F4 — Resumability (new scope)

- Analysis already checkpoints naturally: `.ptah/analysis/<slug>/manifest.json` +
  one file per phase. But `createSlugDir` (`analysis-storage.service.ts:59-75`)
  `rm -rf`s the slug dir on every start, and `analyzeWorkspace` has no notion of
  "start at phase N". `cancelAnalysis` aborts the master controller; remaining
  phases are recorded `skipped`.
- Generation has no checkpoint: `runGenerationInBackground` is fire-and-forget with
  a single in-memory `isGenerating` flag; a host restart loses everything, and the
  wizard frontend state (`SetupWizardStateService`) is in-memory too.
- Reference pattern already in the repo: the fleet workflow
  (`.claude/skills/fleet-orchestration`, TASK_2026_357) is checkpoint-resume based.

### F5 — .gitignore (new scope)

- Current: `.claude/*` ignored; `!.claude/agents/` + `.claude/agents/*` +
  `!video-director.md`; `!.claude/skills/` + `.claude/skills/*` +
  `!video-showcase/**` + fleet-orchestration; `commands/` and `output-styles/` fully
  ignored. Counts today: agents 15 files (1 tracked), commands 7 (0), skills 352 in
  29 dirs (6 tracked), output-styles 1 (0).
- Risk to surface: `.claude/skills` is a harness-sync MANAGED directory. Most of
  the 29 skill dirs are mirrored plugin copies. A committed copy that another
  machine's manifest does not own is reported `foreign`/`blocked` by
  `ClaudeTarget` (`claude-target.ts:199-294,459-512`) unless content matches and it
  is adopted. Plugin updates would also surface as git diffs on every machine.

## Scope

In scope:

1. Phase timeout ⇒ `failed` (+ `error`), partial text preserved but never
   `completed`; text capture must not be the throttled UI stream.
2. `enhanced-prompt.md` (+ small JSON meta) written into the analysis slug dir on
   every successful `runWizard`/`regenerate`.
3. Generation watchdog aborts the orchestrator OR the completion reflects the real
   outcome; per-agent `written | unchanged | failed` + `rejectedSections`, output
   directory, and propagation whenever files were written; surfaced in
   `GenerationCompletePayload` and the completion step UI.
4. Resumable analysis + generation: on-disk checkpoints, `resume` entry points
   (RPC + UI), pause = graceful cancel that keeps checkpoints, host restart picks
   up from the manifest.
5. `.gitignore`: track `.claude/agents`, `.claude/commands`, `.claude/output-styles`
   (+ skills per the user's decision below); keep the rest of `.claude/*` ignored.
6. Specs for every new path.

Out of scope: root cause of the phase-3/4 stall; `GeneratedSectionValidator`
over-rejection (follow-up task); redesign of the wizard UI beyond the completion
and analysis-results steps.

## Strategy

Task type: BUGFIX + FEATURE. Depth: Full (analysis done by orchestrator, recorded
above). Sequence: software-architect → user review → team-leader (batches) →
backend-developer / frontend-developer → senior-tester → reviewers → commit.

## Execution log

- 2026-08-31 ~04:00–05:45: three `software-architect` Task sub-agents were interrupted
  before writing anything. User instruction: **use CLI agents, not Claude Task
  sub-agents**, for the rest of this task.
- 2026-08-31 02:49Z: architect delegated to codex CLI agent
  `7060e74e-3ff0-4b21-b0cf-d5bc000e1bdf` (deliverable: `implementation-plan.md`).
  Resume with `ptah_agent_status` → CLI Session ID → `ptah_agent_spawn { resume_session_id }`.
- 2026-08-31 02:56Z: that run FAILED with `Selected model is at capacity` (default
  codex model `gpt-5.6-sol`). CLI session `01a055b8-bb46-7703-b7a3-fd8c2707ea2f`.
- 2026-08-31 ~03:00Z: resumed the same session with `model: gpt-5.6-terra`
  (ids from `~/.codex/models_cache.json`: gpt-5.4, gpt-5.4-mini, gpt-5.5,
  gpt-5.6-luna, gpt-5.6-sol, gpt-5.6-terra).
- 2026-08-31 03:07Z: codex agent `7127a467-591b-4c01-8023-35cc02ed6aed` completed
  (exit 0). Wrote `implementation-plan.md` (428 lines). Checkpoint 2 presented to
  the user. User replied APPROVED.
- 2026-08-31 03:17Z: team-leader MODE 1 delegated to codex CLI agent
  `788cc368-8ffa-43ac-af17-86b2ea646e1c` (model gpt-5.6-terra, deliverable `batches.md`).
- 2026-08-31 03:3xZ: team-leader completed (exit 0), `batches.md` written: 5 batches
  (1 contracts → 2 agent-generation services → 3 rpc-handlers → 4 setup-wizard;
  5 `.gitignore` independent). Batch 1 spawned as codex CLI agent (see below).
  Batch 5 executed by the orchestrator (mechanical policy edit). Executors write
  `batch-N.report.md` into this folder when done.
- 2026-08-31 03:26Z: Batch 1 spawned as codex CLI agent
  `20df127d-6754-4f20-91bf-58ad9432f557` (gpt-5.6-terra).
- 2026-08-31 03:4xZ: Batch 5 COMMITTED as `84892c088` on branch
  `chore/normalize-husky-line-endings` (the user's current working branch; not
  switched to avoid disturbing their unrelated in-progress agent-sdk changes).
  Deviations recorded in batches.md. `.prettierignore` gained `.claude/`.
- 2026-08-31 ~03:55Z: Batch 1 IMPLEMENTED (report: batch-1.report.md). Commit
  deferred — folded into Batch 2's commit. Batch 2 spawned as codex CLI agent
  `80fa7097-1eaa-4667-aee8-eac81a951979` (gpt-5.6-terra) at 03:36Z.
- STAGING RULE for the Batch 1+2 commit: the worktree also carries the user's
  unrelated edits in `libs/shared/src/lib/types/execution/stream-background.ts`,
  `execution/stream.ts`, `rpc/rpc-session.types.ts`, `sdk-hook.schemas.ts` and many
  `libs/backend/agent-sdk/**` files. Stage ONLY: Batch 1's nine files
  (`shared/.../rpc/rpc-setup.types.ts`, `shared/.../rpc.types.ts`,
  `shared/.../wizard/phase.ts`, `agent-generation/.../types/{multi-phase,core,
enhanced-prompts,generation-checkpoint}.types.ts`, `types/index.ts`,
  `interfaces/{content-generation,agent-file-writer}.interface.ts`) plus the
  Batch 2 file list from batches.md (+ `core.types.spec.ts` if touched).

- 2026-08-31 ~06:0xZ: Batches 1+2 COMMITTED as `34b928a44` (25 files, +3752/-964).
  Batch 2b (three remaining code-logic review fixes) applied by the orchestrator
  and COMMITTED as `0424addac` (6 files). agent-generation: 30/30 suites,
  947/947 tests. Next: Batch 3 (rpc-handlers), then Batch 4, then Batch 6.

## Decisions

- cli_delegation: **auto** (user, checkpoint 0.1). Available: codex (cli),
  antigravity (cli), claude cli (ptah-cli `pc-effaa2c4-0d41-4e95-980a-89d3bf971b4d`),
  ollama cloud (ptah-cli `pc-85830910-3d81-4248-84c1-4fa52752dd19`). copilot disabled,
  cursor/opencode/pi not installed. Team-leader recommends per batch; orchestrator
  spawns. Max 3 concurrent.
- `.claude/skills` tracking scope: **all of `.claude/skills`** (user decision after
  the harness-sync foreign/blocked risk was surfaced). Keep `.claude/settings.local.json`,
  `.claude/worktrees`, and everything else under `.claude/*` ignored. Keep
  `.claude/workflows` as it is today.
