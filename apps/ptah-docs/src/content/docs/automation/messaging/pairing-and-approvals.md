---
title: Pairing and Approvals
description: How PtahCode authorizes a new sender before any agent work starts.
---

# Pairing and Approvals

The gateway puts each new sender through a pairing step. A sender cannot start an agent turn until you approve the binding.

## The pairing steps

```text
1. A message arrives from sender X.
        ↓
2. Is X on the platform allow list? If the list has IDs and X is not on it,
   the message is ignored. An empty list accepts all senders.
        ↓
3. Does X have an approved binding? If yes, the message starts a turn.
        ↓
4. If not, PtahCode creates a pending binding with a 6-digit code.
   The bot sends the code one time.
        ↓
5. In Thoth → Messaging → Access, type the code and click Approve.
        ↓
6. The binding is approved. Messages from X now start turns.
```

## Binding statuses

| Status     | Meaning                                      |
| ---------- | -------------------------------------------- |
| `pending`  | The code was sent. The binding waits for you |
| `approved` | Messages from the sender start agent turns   |
| `rejected` | You rejected the request                     |
| `revoked`  | You revoked an approved binding              |

## Manage bindings

The **Access** section of each platform pane has two lists:

- **Pending requests** — type the code from the bot, then click **Approve**. Click **Reject** to refuse the request.
- **Approved** — click **Revoke** to remove access from a sender.

An entry can also have a button that adds the sender to the allow list.

## Tool approvals in a turn

Pairing is the first gate. Tool approval is the second gate. At the default level `ask`, only read-only tools run without approval. For other tools, PtahCode shows the approval prompt in the desktop app, and the chat gets this notice:

```text
Ptah needs approval to run `<tool>`. Approve it in the Ptah desktop app ...
```

If no approval arrives in time, the agent skips the tool and continues. The level comes from `gateway.permissionLevel`: `ask`, `auto-edit`, or `yolo`. The Messaging tab has no control for it.

:::caution[Lock down the allow list]
An empty allow list accepts any sender that the bot can see. Add at least one ID for each platform that you enable.
:::
