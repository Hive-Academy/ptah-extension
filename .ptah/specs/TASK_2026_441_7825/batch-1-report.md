# Batch 1 report — TASK_2026_441_7825

## Completion

- Task 1.1: Retargeted the validator to the shipped `ptah-core/skills/orchestration` and agent templates (`scripts/validate-orchestration-skill.ts:148-167`); added `fleet.md` (`:135-145`); changed missing-template and missing-reference diagnostics to name shipped paths (`:422-436`, `:509-521`, `:679-686`). The retained syntax, link, strategy, agent, invocation, required-section and line-count checks still run (`:695-716`). All 14 required IDs match `*.template.md` basenames under `libs/backend/agent-generation/templates/agents`; no missing-template diagnostic appeared in the validator run.
- Task 1.2: Added one heading-scoped, ordered marker helper (`scripts/validate-orchestration-skill.ts:554-619`) and assertions for Gate 0.1, CLI defaults, subagent reasons, per-turn signals, limit fallback, document-gate escalation, separate shipping-code review, fleet cap and judge keys (`:621-661`). The shipping-code markers are constrained to its bold bullet. The helper reads the shipped `agent-lanes/SKILL.md` and the source `team-leader.template.md` (`:166-167`), and skips markers for absent fleet/template files because the retained required-file checks give their missing-path diagnostics (`:563-566`).

## Verification

Command: `npm run validate-skill 2>&1 | tail -60` in Git Bash. The first Git Bash attempt stopped at TS2532 compilation errors in the new helper. I fixed those accesses at `scripts/validate-orchestration-skill.ts:576-588` and ran the same command again. PowerShell could not resolve `tail`, so its initial pipeline never started the validator. The Git Bash command's pipeline exit code was 0 because `tail` succeeded; the validator itself printed `VALIDATION FAILED`, which is expected at this batch.

Second-run tail (ANSI color removed; the tail omits earlier diagnostics):

```text
Missing or out-of-order policy marker in 4. Run: supersedes
Missing or out-of-order policy marker in 4. Run: pending
Missing or out-of-order policy marker in 5. Recover: AT LIMIT
Missing or out-of-order policy marker in 5. Recover: reset unknown
Missing or out-of-order policy marker in 5. Recover: other family same capability
Missing or out-of-order policy marker in 5. Recover: same family other provider/model
Missing or out-of-order policy marker in 5. Recover: subagent
Missing or out-of-order policy marker in 5. Recover: reset unknown
Missing or out-of-order policy marker in 5. Recover: skip
Missing or out-of-order policy marker in 6. Verify and revise: **Document gates
Missing or out-of-order policy marker in 6. Verify and revise: **Shipping code
Missing or out-of-order policy marker in 6. Verify and revise: Review family
Missing or out-of-order policy marker in 6. Verify and revise: weaker evidence
Files checked: 8
Errors: 22
Warnings: 0
VALIDATION FAILED
```

After that run I tightened the §6 shipping-code marker to the plan's `different family`, `specific reason`, and `weaker-evidence label` wording and limited it to the Shipping code bullet (`:590-595`, `:646-652`). I did not run the validator a third time; this final refinement is unverified under the requested limited-run policy.

Expected-failure list observed: the visible tail shows only new marker failures in agent-lanes §4/§5/§6. The full expected-red list for B1 is Gate 0.1/checkpoints, lane-assignment, agent-lanes §4/§5/§6, team-leader template, and missing `fleet.md`. Those earlier categories fell outside the 60-line tail, so this run alone does not independently prove their exact diagnostics. No retained-check failure appeared in the visible tail. The Batch 1 expected-red acceptance is therefore only partially evidenced by the requested tail.

## Risks and edge cases

- R2-1 quota authority, unknown reset, resumed-agent identity, and non-limit recovery: validator now requires `AT LIMIT`, `reset unknown`, ordered fallbacks and skip markers in agent-lanes §5 (`:639-645`); policy wording belongs to Batch 2.
- Queued message after a delivered signal: §4 requires per-turn signal, later supersession and pending-queue markers (`:636-638`); Batch 2 supplies the text.
- R2-2 document escalations: checkpoint approval mode and agent-lanes §6 require same-side, capped REVISE, removal and user markers (`:629-631`, `:652-654`).
- R2-3 bullet form: §6 asserts `**Document gates` before `**Shipping code`, then the Shipping code review-family/reason/evidence markers (`:646-652`).
- R2-4 vendor roster replacement, memory conflicts/unavailability, no-spawnable preference, fleet one-ID behavior and respawn no-op, and repo-local Nx rule: implementation is assigned to Batches 2, 3 and 5; Batch 1 only checks the specified policy markers.
- Hash-pinned skill trigger manifest: Batch 6 owns the jsonl and manifest; untouched here.
- Repo-local fleet workflow status ownership: Batch 5 owns this; untouched here.
- H1 expected-red period: retained checks remain wired (`:695-716`), and the new fleet missing-file check remains active (`:143`, `:509-521`). Batch 4 must retire the marker failures.
- Cross-batch fixed vocabulary and packaging order: assertions use the agreed fallback terms (`:642-644`); no plugin content, manifest or version file changed in this batch.

## Files written

- `D:\projects\ptah-extension\.claude-worktrees\task-441-lanes-first-c89362de48e8\scripts\validate-orchestration-skill.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-441-lanes-first-c89362de48e8\.ptah\specs\TASK_2026_441_7825\batch-1-report.md`

`ptah_agent_report` is unavailable in this lane's tool list, so I could not send the required direct parent-session report. The final message carries this path and summary instead.
