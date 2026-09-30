# Task Context - TASK_2026_588_f4f8

## Origin

Phase 5 of the Thoth umbrella TASK_2026_439_1310. Filed 2026-10-01. The user decided that phase 5 gets its own child
task, because TASK_2026_578_3b00 lists "the evidence-first archaeology pipeline (TASK_2026_439 phase 5)" as out of
scope. Requirements source: `../TASK_2026_439_1310/tribunal/verdict.md` section B ("Root causes" 1-3, "Target
design", "Live disagreement", "Reachability proof").

## Split with TASK_2026_578_3b00

- 578 owns: umbrella merge of existing candidates/suggestions/promoted skills, the deciding judge gate, promote on
  accept, usage-based retirement, backlog purge.
- This task owns: the stage order before a candidate exists, and cross-session routine clustering before authoring.
  Promotion from real `skill_invocation_events` uses 578's path; do not build a second one.

## Root causes (re-verify line numbers on the working branch)

1. Author-before-evidence: `prefilter` calls `analyzeSession`, which drafts, then enqueues archaeology and the gates
   (`stage-handlers.service.ts:266-286`). The synthesizer reads a verdict that does not exist yet
   (`skill-synthesis.service.ts:781-786`), and its prompt says to produce a skill even for a one-off session
   (`skill-synthesizer.service.ts:243`).
2. Loose eligibility remains where phase 3 did not tighten it.
3. Names come from the first prompt (`trajectory-extractor.ts:230-232`).

## Target (verdict)

prefilter → archaeology → reject degraded/no-routine verdicts (visible reason) → cluster routines across ≥ 2
sessions → author ONE draft from the cited steps → judge + trigger eval → probation → promote on real usage (578).

The verdict's "live disagreement": archaeology-first may stall on a backlog (56/136 degraded verdicts at the time).
Measure the archaeology queue before and after on the live DB, and plan a throughput guard.

## Acceptance

- Reachability proof (verdict B): an integration spec in which routines from at least two distinct sessions are
  clustered before authoring, a real (fake-lane) session that is eligible twice across contexts ends `promoted`,
  and a conversation-only session produces nothing. A single session seen twice must not satisfy the cluster gate.
