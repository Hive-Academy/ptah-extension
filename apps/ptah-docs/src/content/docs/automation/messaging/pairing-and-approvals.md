---
title: Pairing & Approvals
description: How new senders get authorised before any agent work happens.
---

# Pairing & Approvals

A bot-with-tools that talks to anyone is a bad bot. The Messaging Gateway gates every new sender behind a one-time pairing handshake.

## The handshake

```text
1. Inbound message arrives from sender X
        ↓
2. Sender X is in the platform allow-list (allowedUserIds / allowedGuildIds /
   allowedTeamIds)? If no → ignored, no reply
        ↓
3. Existing approved binding for X? If yes → forward to agent
        ↓
4. Otherwise: create a "pending" binding, generate a 6-digit pairing code,
   bot replies with the code
        ↓
5. User approves the binding in the Bindings UI (or via gateway:approveBinding
   RPC) using the code
        ↓
6. Binding flips to "approved". Future messages from X go straight to the agent
```

## Statuses

| Status     | Meaning                                                  |
| ---------- | -------------------------------------------------------- |
| `pending`  | Pairing code issued, waiting for approval                |
| `approved` | Active — messages forwarded to the agent                 |
| `rejected` | Permanently blocked from progressing                     |
| `revoked`  | Was approved, then revoked. Re-pairing requires new code |

## RPC surface

| Method                   | Purpose                                |
| ------------------------ | -------------------------------------- |
| `gateway:listBindings`   | List all bindings, any status          |
| `gateway:approveBinding` | Move `pending` → `approved` with code  |
| `gateway:rejectBinding`  | Move `pending` → `rejected`            |
| `gateway:blockBinding`   | Block future messages from the binding |
| `gateway:revokeBinding`  | Revoke an approved binding             |

## Approval gates inside conversations

Pairing is the **outer** gate. Once a sender is paired, normal Ptah approval prompts still apply for destructive tools (writes, deletes, network calls). The chat platform just relays the approval prompt as a message — you reply yes/no there and the agent continues.

:::caution[Allow-list isn't optional]
If the platform allow-list is empty, **no inbound message is ever processed**, even from a previously-approved binding. The allow-list is the first line of defence; pairing is the second.
:::
