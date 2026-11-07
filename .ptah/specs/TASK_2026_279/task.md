---
id: TASK_2026_279
status: backlog
type: feature
title: >-
  Add a provenance marker to harness skill and command copies
description: >-
  Unowned skill and command copies that Ptah wrote before the manifest existed still read
  as `foreign`. Write a provenance marker on every copy, and let the reconciler adopt an
  unowned entry that carries it. Leave user-authored files untouched.
parent: TASK_2026_640_11a5
labels:
  - P2
updated: 2026-11-07T00:00:00.000Z
---

# Harness provenance marker

Machine-owned metadata carrier. Prose lives in `./context.md`.

## Description

The reconciler owns an entry only if the target manifest names it. Agent files are adopted by
signature (`source: ptah`, `libs/backend/harness-sync/src/lib/targets/workspace-target.ts:612`
`isPtahOutput`). Skills and commands have no signature. Remaining work:

- Marker: write a frontmatter key on every `SKILL.md` and command copy (reuse `source: ptah`
  or add `ptah_source: <sourceId>`). Files inside a skill dir rely on the `SKILL.md` marker.
- Adoption: in `planEntry` (`libs/backend/harness-sync/src/lib/targets/claude-target.ts:205`,
  `:249` and `workspace-target.ts`), adopt an unowned entry whose marker says Ptah. No marker
  keeps it `foreign`.
- Legacy sweep: decide how to treat old copies with no marker (see `context.md`, Scope 3).
- Specs for marker write, adoption on match, no adoption without a marker, and the sweep.
- Acceptance is checked through the `harness:health` / `harness:reconcile` RPCs and the
  Marketplace harness health badge in Electron. The `ptah harness doctor` CLI named in
  `context.md` was removed with the CLI host (`1cee6fafe`).

## Current state (2026-11-07)

- Done elsewhere: `b3dc1b83a` reports hand-edited copies (`keptLocalEdit` / `localEdit`,
  `libs/backend/harness-sync/src/lib/health/harness-health.ts:68-90`). That covers the old
  "deep verify" item.
- Done elsewhere: `12cc37071` added a consent-based repair of blocked paths
  (`repair/blocked-repair.service.ts`, RPC `harness:repairBlocked`). It quarantines the occupant
  only when the user asks.
- Done elsewhere: legacy `.claude/commands/.ptah-managed.json` entries are adopted
  (`claude-target.ts:701` `adoptLegacyCommandManifest`).
- Not done: no skill or command provenance marker, and no marker-based adoption.
- `libs/backend/harness-sync/CLAUDE.md` does not exist; document the marker in the lib README or
  a new lib doc.
