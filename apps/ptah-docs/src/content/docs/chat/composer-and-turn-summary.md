---
title: Composer and Turn Summary
description: Queue follow-up messages while a turn runs, message another session, read the context usage, and review the summary of each turn.
sidebar:
  order: 11
---

# Composer and Turn Summary

This page tells you how to send more messages while the agent works, how to send a message to a different session, and how to read the summary at the end of each turn.

## Queue follow-up messages

You can send a message while a turn runs. The **Send message** button stays available. PtahCode puts the message in a queue and sends it when the current turn finishes.

The queued messages show above the composer in the **Queued messages** list. Each item shows a short preview of the text and its status:

| Status                          | Meaning                                                   |
| ------------------------------- | --------------------------------------------------------- |
| **Waiting to queue**            | The message waits to go into the queue.                   |
| **Queuing…**                    | PtahCode adds the message to the queue.                   |
| **Queued for the next turn**    | The message goes to the agent when this turn finishes.    |
| **Runs when this turn finishes** | A slash command waits for the current turn to finish.    |

### Edit a queued message

1. Click **Withdraw** on the queued item.
2. The text goes back into the composer. Edit it.
3. Send the message again.

### Send a queued message now

You do not have to wait for the turn to finish:

- In a Codex session, click **Send now**. The message goes into the running turn.
- In other sessions, click **Interrupt & send**. PtahCode interrupts the turn and sends the message.

If PtahCode cannot do the action, the message stays in the queue with a short note.

### Queued messages to an agent lane

The composer of an agent lane also queues messages. It shows the number of queued messages, for example **2 queued**, and the last one. To change a queued message, click **Edit**. The text goes back into the lane composer.

## Message another session

You can send a message from the current session to a different session.

1. Send a prompt first. The current session must exist before you can use this.
2. Click **Peer** in the status line below the composer. The **Message Peer Session** dialog opens.
3. Select the **Target Peer Session**.
4. Type the **Message**.
5. Read the **Notice before sending**.
6. Click **Send**.

The notice tells you two things:

- **Consumes a turn**: the send uses a turn in the current session.
- **Model-mediated**: the model does the send. It can change the words of the message, or it can decline to send it.

The result is **Accepted** or **Refused**. Click **Send another** to send one more message, or **Done** to close the dialog.

### Messages from other sessions

A message that a different session sends to this session shows as a row in the transcript. The row has the caption **· self-reported**. This tells you that the message came from a different session, and that PtahCode cannot verify the sender name.

## Context usage

Each session card in the Sessions rail shows **Context** and the part of the context window that the session uses, for example **Context 42%**. When the value is not known, the card shows **—**.

The [Session details](/canvas/session-inspector/#session-stats) inspector also shows the **Context** metric.

## Turn summary

At the end of a turn that changed files or ran tests, the transcript shows a **Turn summary** chip. The chip shows short metrics, for example **3 files**, **+42**, **−7**, and **2 tests passed**. When the turn stopped or failed before it finished, the chip shows **incomplete**.

Click the chip to expand it. The expanded chip shows cards for **Files**, **Lines**, **Tokens**, **Cost**, **Time**, and **Tests**. The **Files**, **Lines**, and **Tests** cards show only when the turn has that data. Press **Esc** to collapse the chip.

### Changed files

The **Changed files** list has one row for each file that the turn changed. Each row shows the status, the path, and the added and removed lines.

- Click **Review** to show the file in review.
- For a file with a merge conflict, the row shows **Conflicted**. Click **Resolve** to resolve the conflict.
- Click **Review all** to review all the changes of the turn.

The list can include changes that were made before the turn. Refer to [Diffs](/git/diffs/).

### Test results

The **Test results** list shows the share of tests that passed and one row for each test run. Each row shows the outcome and the project. If a run failed, the row shows the first failure lines. Expand **Full command** to see the command that ran the tests.

## Next steps

- [Sending messages](/chat/sending-messages/)
- [Display panel](/chat/display-panel/)
- [Agent sessions](/agents/agent-sessions/)
