---
title: Hand Off a Session
description: Hand a canvas session to a Telegram, Discord, or Slack binding, and resolve it back to the desktop app.
---

# Hand Off a Session

You can hand a session from the Orchestra Canvas to an approved messaging binding on Telegram, Discord, or Slack. You then continue the session from the chat app. While the session is handed off, its tab in PtahCode is read-only.

A hand-off is not a share. The platform that you pick takes over the tab until you resolve it back.

## Before you start

- Set up the messaging gateway and start the adapter for the platform. See [Messaging Gateway](/automation/messaging/).
- Approve a binding for your account on the platform. See [Pairing and approvals](/automation/messaging/pairing-and-approvals/).
- Send at least one message in the session and wait for the reply. A session with no saved turn cannot be handed off.

## Hand off a session

1. In the **Sessions** rail of the canvas, click **Session actions** (⋮) on the session card.
2. Click **Hand off session to…**. The picker shows the approved bindings.
3. Click a binding. PtahCode asks **This tab becomes read-only and is driven from** the binding **. Continue?**
4. Click **Continue**.

PtahCode shows **Attached to** and the platform name. The tab is then read-only in PtahCode.

## Resolve the session back

1. Click **Session actions** (⋮) on the session card.
2. Click **Resolve back to webview**. The menu item also shows **Driven from** the platform **· read-only here**.

PtahCode shows **Resolved back to webview**, and you can use the tab in PtahCode again. This action does not ask for confirmation.

## When the hand-off is unavailable

**Hand off session to…** stays in the menu but is disabled when a hand-off cannot occur. The item then shows **Hand off unavailable** and the reason:

| Reason                                    | What to do                               |
| ----------------------------------------- | ---------------------------------------- |
| **no session yet — send a message first** | Send a message in the session            |
| **this session is already handed off**    | Resolve the session back first           |
| **this tile has no chat tab yet**         | —                                        |

The picker can also show these messages. In these messages, "Gateway tab" is the **Messaging** tab of Thoth.

| Message                                                                   | What to do                                          |
| ------------------------------------------------------------------------- | --------------------------------------------------- |
| **No approved bindings. Approve one in the Gateway tab first.**           | Approve a binding under **Pending requests**        |
| **platform offline — start it in Gateway tab**                            | Start the adapter of the platform                   |
| **That binding isn’t approved yet — approve it in the Gateway tab, then try again.** | Approve the binding                      |
| **This session has no saved turn yet, so it can’t be resumed from a messaging app.** | Send a message and wait for the reply    |

## Related

- [Messaging Gateway](/automation/messaging/)
- [Pairing and approvals](/automation/messaging/pairing-and-approvals/)
- [Orchestra Canvas](/canvas/)
