# Code Logic Review, Phase 2 (Batches 5, 5F, 6), TASK_2026_441_7825

Reviewer: antigravity
Score: 7/10
Verdict: REVISE

Scope: `git diff 9abb42991 672a68797 -- CLAUDE.md .claude/workflows/fleet-fix.js libs/frontend/chat-ui tools/mcp-bench/src`, plus the deleted `fleet-orchestration` SKILL.md. No tests were run. The orchestrator's results were taken as given.

## Check 1: Parity (deleted skill -> new homes)

| Old section | Home | Result |
| --- | --- | --- |
| §1 Entry | `fleet.md` "Entry", `orchestrate.md` fleet trigger | kept |
| §2 Harness limitation | `fleet-fix.js:11-12` header, `fleet.md` "Resume from disk" | kept |
| §3 Checkpoints (`judge-round-N.json` keys, no-op respawn, edit only the status line) | `fleet.md` "Checkpoints" and "Resume from disk" | kept |
| §4 Disjoint batching and the 6-files / 2-libs cap | `fleet.md` "Disjoint batching" | kept |
| §5 Commit window (stash/restore hook reverts edits) | `git-standards.md:45` "Quiet commit window" | kept. `lint-staged` is no longer named, which is deliberate genericization. |
| §6 Commitlint (72/100 limits, `security` and `git` not scopes, scope enum) | `CLAUDE.md:18-21` | mostly kept |
| §7 Nx test rule | `CLAUDE.md:22-25`, the `fleet-fix.js:138,172` prompts | kept |
| §8 Judge protocol (cited defects, max 2 rounds, read-only, writes JSON) | `fleet.md` "Judge protocol" | kept |
| §9 CLI lanes | `agent-lanes/SKILL.md`, linked from `fleet.md` | kept |

### Finding M1 (Moderate): "Multi-scope with commas is allowed" was lost
- Evidence: the old skill §6 states it. Neither `CLAUDE.md:18-21` nor `git-standards.md` carries it.
- Impact: a worker may split a multi-lib change into several commits, or reject a valid `fix(a,b):` subject.
- Fix: add "multi-scope with commas is allowed (`fix(agent-sdk,chat): ...`)" to `CLAUDE.md:18-21`.

No other rule was lost.

## Check 2: `fleet-fix.js` implement checkpoint

The skip condition at `fleet-fix.js:136` skips implementation when `status` is `in_review` or `done`, or when `stage` is `implement` or `judge`. The new header (lines 9, 14) says the caller alone writes `task.md` status. This is consistent with `fleet.md` status ownership. The implement prompt (line 138) forbids status edits and requires `implementation.json`. Skipping on `in_review` is now safe, because only the orchestrator can set that status, and only after checking the artifact.

### Finding S1 (Serious): a blocked implementation is treated as finished on resume
- Evidence: lines 146-149 return early with `finalStage='implement'` and `blocked=true`. The agent has already written `implementation.json` with `blocked:true`. The header (line 14) tells the caller to set `stage:'implement'` for the presence of `implementation.json`, and says nothing about `blocked`. On re-invocation, line 136 skips implementation because `stage==='implement'`. Line 153 then judges unfinished work.
- Impact: a task whose implementer reported `blocked` can go to a judge and then possibly to `in_review` or `done`. This is a skipped-unfinished-work path.
- Fix: in the header, tell the caller to set `stage:'implement'` only when `implementation.json` exists with `blocked:false`. Optionally also mention that `typecheckOutcome` and `testOutcome` must be checked. Alternatively, return `finalStage:'plan'` at line 149.

### Finding M2 (Moderate): `implement` and `judge` stages are indistinguishable from a partial implementation
- Evidence: `stage` is caller-computed, and the sandbox cannot read disk (header line 13). A crash mid-implementation leaves no `implementation.json`. A caller that follows the header correctly will not set `stage:'implement'`, so work is redone, which is safe. A caller that sets it from `task.md` status alone skips unfinished work. `fleet.md` "Checkpoints" says status alone is not evidence, but the script's `status` skip at line 136 trusts it.
- Fix: add one header sentence: "`status` in_review/done is trusted only if the orchestrator verified `implementation.json`."

### Finding M3 (Moderate): the revise stage has no checkpoint
- Evidence: line 153 starts at `rounds+1`. If a crash happens after a failed judge round 1 and before the revision finishes, a resume with `judgeRound:1` goes straight to judge round 2. The defects were never fixed, and `revision-round-N.json` is never consulted.
- Impact: judge round 2 runs against unrevised code. It will probably fail, and the task escalates after burning a round.
- Fix: accept a `task.revisedRound` arg and skip the revise agent when it matches. Alternatively, document that the caller must reset `judgeRound` to `n-1` when `revision-round-n.json` is absent.

### Finding M4 (Moderate): prompts contradict the `fleet.md` read-only judge
- Evidence: the judge prompt (line 156) says "Run the relevant tests". It does not say judges never edit source or `task.md`. The revise prompt (line 172) lacks the "Do not edit task.md status" sentence that the implement prompt has. `fleet.md` "Judge protocol" says a judge writes only its JSON.
- Fix: add "Read-only: write only ${verdictPath}; never edit source or task.md" to the judge prompt. Add "Do not edit task.md status" to the revise prompt.

## Check 3: mcp-bench trigger labels

- `trigger-human-eval.ts`: `TRIGGER_LABELS_TARGET` is v2, `EXPECTED_LABELLED_SKILLS` is 22, and the `groundTruthVersion` default is v2.
- `committed-u4-labels.spec.ts`: v2 file with 22 rows. `namer-and-trigger.suite.spec.ts`: v2 paths, the `ground-truth-absent ...@v2` regex, `expectedSkills: 22`, and "3 of 22".
- No `skill-triggers.v1` or `triggers@v1` reference remains in `tools/mcp-bench/src`.

### Finding m1 (Minor): `version: 'v1'` is left on `gt-skill-triggers` in three specs
- Evidence: `memory-skills-suite-kinds.spec.ts:455-456,471-472`, `projection.spec.ts:278-279`, `suite-result.spec.ts:174-175`.
- Impact: these are synthetic, self-contained fixtures, so they do not break. They do misdescribe the current ground-truth version, and a reader may take them for the real one.
- Fix: bump them to `'v2'` for consistency. This is optional and not blocking.

## Check 4: `prompt-suggestions.component.ts`

- Evidence: lines 228 and 299 now read `/orchestrate TASK_A TASK_B ...`. `orchestrate.md` defines `/orchestrate TASK_A TASK_B ...` as the multi-ID fleet trigger and routes several resolved IDs to `references/fleet.md`.
- The placeholders `TASK_A` and `TASK_B` are not valid IDs. `orchestrate.md` rejects malformed IDs before any spawn, and the user is expected to replace them, as the old `[task spec range]` placeholder was.

### Finding m2 (Minor): the fleet suggestions are indistinguishable from a request to fix literal IDs `TASK_A`/`TASK_B`
- Evidence: the suggestion text is inserted as-is and has no bracket marker.
- Fix: use `TASK_YYYY_NNN TASK_YYYY_NNN` or bracketed `[TASK_A] [TASK_B]` so the placeholders are obvious.

## Five logic questions

1. **Silent failure.** S1: a blocked implementation resumes as finished. M3: the revise stage is silently skipped on resume.
2. **Unexpected user action.** Sending the `/orchestrate TASK_A TASK_B` placeholder text unedited is rejected up front by ID validation. This is safe.
3. **Wrong answer from input.** A caller setting `stage:'implement'` from a status line alone produces the wrong stage (M2).
4. **Dependency failure.** An implement or judge agent that throws is caught at the `try` block near line 186. `finalStage` is not advanced, so the task is safely re-run.
5. **Missing.** Revise checkpointing (M3) and a blocked-state rule (S1).

## Summary

| Severity | Count |
| --- | --- |
| Blocking | 0 |
| Serious | 1 (S1) |
| Moderate | 4 (M1-M4) |
| Minor | 2 (m1, m2) |

The fixture, v2 labels and parity work are correct. The one Serious finding is the blocked-implementation resume path in `fleet-fix.js`.

**Verdict: REVISE (0 Blocking, 1 Serious: fix S1, then APPROVED; M1-M4 recommended).**
