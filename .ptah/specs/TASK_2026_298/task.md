---
id: TASK_2026_298
status: backlog
type: refactoring
title: >-
  Unify the participant concept — one family key, one output contract, and the
  model lane Codex and Copilot are structurally denied
description: >-
  "Participant" is one concept forked across six layers, and the fork is
  invisible until the path is traced end to end. A vendor reached as a MODEL
  (`auth-providers` translation proxy → Claude Agent SDK) and the same vendor
  reached as an AGENT (`cli-agent-runtime` `CliAdapter` → vendor SDK/binary)
  disagree on discovery builder, identity key, model-listing RPC, spawn-arg
  shape, execution route, and output vocabulary. The tribunal is where that
  fork already costs correctness: `buildCliFamilyLanes` stamps `family: cli`
  (`'codex'`) while `buildProviderLanes` stamps `family: provider.id`
  (`'openai-codex'`), and `validateCrucible` / `validateRelay` gate independence
  on `family` alone — so the two schemes read as different families to a rule
  whose entire purpose is to stop a lane grading its own output.
  `CLI_FAMILY_PROVIDER_IDS` then suppresses Codex and Copilot from the provider
  lane set, which reads as de-duplication of the vendor picker but functions as
  an execution-path decision: the two vendors with BOTH integrations built are
  the exact two that can never hold a full-fidelity lane. Underneath,
  `SdkHandle` carries nine optional members and `AgentProcessManager` subscribes
  to `onOutput`, `onSegment` and `onStreamEvent` unconditionally, so a Codex run
  builds, buffers, ships and dedupes every event twice — four times over
  concurrently during a four-tile tribunal. The deletions this implies
  (`CliOutputSegment`, `onOutput`, `onSegment`) are GATED on a prior
  investigation batch; see `./context.md` — nothing is removed until its real
  consumers are enumerated.
---

# Unify the participant concept

Machine-owned metadata carrier. Prose lives in `./context.md`.
