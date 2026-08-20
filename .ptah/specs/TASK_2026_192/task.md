---
id: TASK_2026_192
status: done
type: BUGFIX
title: Gateway inbound sessions run at permissionLevel 'yolo' (remote auto-approval)
description: gateway-chat-bridge starts agent sessions for inbound Telegram/Discord/Slack messages with permissionLevel 'yolo', auto-approving every tool call. This is a remote, non-interactive path to the agent SDK's full tool surface (Bash and friends) with no approval gate. Establish the reach, then gate it.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-09T00:00:00.000Z
updated: 2026-08-09T00:00:00.000Z
---

## Description

### Origin

Surfaced as an adjacent finding during the TASK_2026_174 P1 reachability audit
(`research-report.md`, "Adjacent findings" #1). It is explicitly **not** the
`terminal:create` defect 174 fixed — it is a separate, and on its face larger,
exposure that was filed so it is a tracked decision with an owner. (Originally
filed as TASK_2026_188; re-filed here after a concurrent session reused that ID.)

### The defect

`libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:423`, `:440`,
`:471` start / resume agent sessions with `permissionLevel: 'yolo'`. Inbound
messages arrive via `gateway.on('inbound')` (`:133`) from the messaging adapters
(Telegram/grammy, Discord/discord.js, Slack/@slack/bolt). `yolo` auto-approves
every tool the SDK exposes — including `Bash`, `Write`, `Edit`, and the MCP
surface — with no user in the loop.

The result is a **remote, non-interactive** path to the agent's full tool
surface. Whoever can deliver a message the gateway accepts can drive tool
execution on the host with the user's privileges.

### Why it matters

174's `terminal:create` hole required an attacker to already have JS execution
in the Electron renderer (second-stage). This path is _first-stage and remote_:
the trust boundary is "can this sender reach the bot", not "has the machine
already been compromised". If the gateway accepts messages from an open channel,
an unbounded set of senders inherits the agent's tool surface.

### Phases

- **P1 — Establish the trust model and reach.** Deliverable is evidence, not
  prose. Enumerate, with citations: how inbound senders are authenticated /
  allowlisted per adapter (is there a sender allowlist? a single owner chat id?
  an open channel?); whether the `yolo` level is unconditional or configurable;
  what tools the gateway session actually exposes; whether a workspace/permission
  scope is applied. The severity of this task is entirely a function of P1 — an
  owner-only, single-chat-id bot is very different from an open channel.
- **P2 — Gate it.** Based on P1, replace unconditional `yolo` with the right
  policy for remote inbound. Options to weigh: a constrained tool allowlist for
  gateway sessions; `ask` routed to an out-of-band approval surface; a
  sender-allowlist precondition; per-gateway configurable level defaulting to
  something safe. Do not silently keep `yolo`.
- **P3 — Coverage.** Tests asserting a gateway inbound session does not
  auto-approve a dangerous tool unless the configured policy explicitly allows
  it.

### Acceptance criteria

1. A reachability/trust-model table for each messaging adapter (who can send,
   how they are authenticated, what the session can do), each row cited.
2. Gateway inbound sessions no longer run at unconditional `yolo`; the chosen
   policy is documented with its rationale.
3. Regression tests proving the gate holds.

### Related

- `TASK_2026_174` — origin (P1 adjacent finding #1).
- `libs/backend/messaging-gateway` — the inbound adapters.
