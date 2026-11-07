---
id: TASK_2026_670_3d09
status: backlog
type: BUGFIX
title: Block renderer writes to secret settings keys
depends_on: []
created: "2026-10-14T17:08:12.674Z"
updated: "2026-11-07T00:00:00.000Z"
description: >-
  settings:set lets the renderer write gateway.*.tokenCipher and provider endpoint keys. Restrict
  these keys at the RPC boundary; confirm the key list with the user first.
estimate: S
labels:
  - follow-up
  - security
relates_to:
  - TASK_2026_655_handoff
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

The generic `settings:set` RPC
(`libs/backend/rpc-handlers/src/lib/handlers/settings-rpc.handlers.ts:199-215`) accepts any
file-based key (`isFileBasedSettingKey`, `libs/backend/platform-core/src/file-settings-keys.ts:547`).
A compromised Electron renderer could therefore replace stored tokens or redirect provider
traffic through these keys:

- `gateway.telegram.tokenCipher`, `gateway.discord.tokenCipher` (`file-settings-keys.ts:257,260`)
- `provider.github-copilot.apiEndpoint`, `provider.openai-codex.oauthApiEndpoint` (`:167,172`)
- any `provider.<id>.baseUrl` (`PROVIDER_BASE_URL_PATTERN`, `:499`, accepted at `:549`)

Expected: deny these keys in `settings:set` (extend `SETTINGS_SET_DENIED_KEYS`, `:79-81`) or move to
an allow-list of renderer-writable keys. Writes that the UI needs go through dedicated RPCs that
validate the value (for example the gateway token and provider settings flows). Check that
`settings:import` cannot bypass the rule. Add specs. Security decision: confirm the key list with
the user before you implement.

## Current state (2026-11-07)

- Not started. `SETTINGS_SET_DENIED_KEYS` holds only `agentOrchestration.decisionModel`
  (`settings-rpc.handlers.ts:79-81`).

Full context, plan and discussion live in [./context.md](./context.md).
