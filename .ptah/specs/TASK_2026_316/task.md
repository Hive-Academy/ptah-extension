---
id: TASK_2026_316
status: in_review
type: FEATURE
title: >-
  Every workspace inherits every skill in the user layer, and disabling a
  bundled plugin no longer removes its skills
description: >-
  Opening any workspace copies the whole of `~/.ptah/user/skills` into
  `.claude/skills`, `.agents/skills`, `.github/skills` and `.cursor/skills`,
  with no per-workspace opt-in. A React project inherits every Angular, NestJS
  and Nx skill the user enabled in some other workspace months ago. Two distinct
  causes, one symptom. (1) `HarnessManifestBuilder.buildSkills`
  (`libs/backend/harness-sync/src/lib/manifest/harness-manifest.builder.ts:175`)
  walks `sources.layout.skillsRoot` — the user-global
  `~/.ptah/user/skills` — and filters it by `disabledSkillIds` alone. Nothing
  asks whether this workspace wanted the skill; the only gate is opt-OUT, and
  it is keyed per skill. (2) `disabledPluginIds` is applied only to the OVERLAY
  loop at `:195-198`, never to the user-layer base, and the user-layer reaper
  keeps a clone whose plugin directory still exists on disk (`classifyUpstream`
  returns `check-plugin-dir`,
  `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-orphan-reaper.ts:123-127`).
  So unchecking a bundled plugin in the Configure modal drops it from
  `enabledPluginIds`, drops it from the overlay — and changes nothing, because
  its skills were mirrored into the user layer on first enable and stay there.
  `apps/ptah-docs/src/content/docs/plugins/skill-toggles.md:38` still documents
  the pre-TASK_2026_278 behaviour ("Disabled plugin + enabled skill = nothing
  junctioned"), which has not been true since the reconciler replaced
  `SkillJunctionService`. Agents got a per-workspace consent gate in
  TASK_2026_286 (`agentSyncEnabled` + `AgentSyncGate`); skills were left ungated
  on the rationale that they are "content the user installed on purpose", which
  holds for the workspace where the install happened and for no other. Two
  sequenced batches: restore the plugin gate, then add the per-workspace skill
  allowlist on the AgentSyncGate shape, including its evidence-based migration
  so existing workspaces are never reaped.
---

# Skills propagate into every workspace with no per-workspace consent

Machine-owned metadata carrier. Prose lives in `./context.md`.
