---
status: in_progress
type: feature
title: Agent two-way messaging
description: >-
  Let a spawned agent message the session that spawned it, and let that session
  message the agent back, so a child can report that it finished and can ask a
  question mid-run instead of only answering at exit. Replaces the
  single-vendor steer path with a capability-driven router.
---

Eleven batches. Batches 1-7, 9 and 10 are committed on
`feat/agent-two-way-messaging` and pushed as pull request #497.

Batch 6 had to be re-implemented: it was finished once, never committed, and
lost when its worktree was removed. `batch-6-report.md` survived and named every
file, so the second pass was a transcription rather than a redesign.

Batches 9, 10 and 11 were added on 2026-09-12, after the original plan.

- **9 (done)** carries the user's session name into the registry name a peer
  reads and into the session title.
- **10 (done)** lists reachable sessions and sends one a message. Its blocking
  research (10.1) is answered in `research-report-addressing.md`: the pinned SDK
  exports no peer-send function, so the route is the model calling the CLI's own
  tool, and **no route can report delivery — only acceptance**. Every outcome
  type on that surface says `accepted`, and a spec scans the source to keep it
  that way.
- **11 (pending)** is the picker. Batch 10 shipped two RPC methods no human can
  reach, because Requirement 10 named no UI surface. The omission is in the
  requirement, not in the batch.

**Batch 8 is the one that matters and is not done.** It is the empirical
acceptance run, and it needs two live sessions and a running host. Until it
happens, no peer message has travelled end to end: the work rests on unit tests,
a protocol read out of a compiled binary, and an argv assertion against the real
SDK. Two risks stay open — whether an SDK-hosted session exposes the CLI's
peer-send tool at all, and that a session Ptah did not start keeps the CLI's
hold-then-expire default, so a message can be accepted, sent and silently held.

This carrier was rebuilt on 2026-09-12. The original folder was never committed
and died with the worktree; `task-description.md`, `implementation-plan.md`,
`batches.md`, `steering-research.md` and the four batch reports were recovered
verbatim from the orchestration session transcript. This file is the one
document with no recoverable original, because the original was minted by
`ptah_task_create` rather than written to disk by an agent.

Scope, requirements and acceptance criteria are in `task-description.md`. The
architecture is in `implementation-plan.md`. The batch breakdown and the
executor prompts are in `batches.md`.
